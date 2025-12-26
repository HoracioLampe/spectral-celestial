const ethers = require('ethers');

// Relayer Engine for High Throughput Processing
class RelayerEngine {
    constructor(pool, providerUrl, faucetPrivateKey) {
        this.pool = pool; // Postgres Pool
        this.provider = new ethers.JsonRpcProvider(providerUrl);
        this.faucetWallet = new ethers.Wallet(faucetPrivateKey, this.provider);

        // Configuration
        this.contractAddress = process.env.CONTRACT_ADDRESS || "0x78318c7A0d4E7e403A5008F9DA066A489B65cBad";
        this.usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

        // Cache for shared Permit signatures (Per Batch logic)
        // Key: batchId, Value: { v, r, s, deadline, amount, signature }
        this.activePermits = {};

        this.contractABI = [
            "function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external",
            "function executeWithPermit(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
            "function processedLeaves(bytes32) view returns (bool)",
            "function distributeMatic(address[] calldata recipients, uint256 amount) external payable",
            "function setBatchRoot(uint256 batchId, bytes32 merkleRoot) external"
        ];
    }

    /**
     * Calculates the total USDC required for a SPECIFIC batch.
     */
    async getBatchTotal(batchId) {
        const query = `
            SELECT SUM(amount_usdc) as total
            FROM batch_transactions
            WHERE batch_id = $1 
            AND status = 'PENDING'
        `;
        const res = await this.pool.query(query, [batchId]);
        const total = res.rows[0].total || 0;
        return ethers.parseUnits(total.toString(), 6);
    }

    /**
     * Generates or retrieves a valid permit signature for a specific batch.
     */
    async ensureBatchPermit(batchId, funderAddress, funderWallet) {
        const now = Math.floor(Date.now() / 1000);
        const cached = this.activePermits[batchId];

        if (cached && cached.deadline > (now + 300)) {
            return cached;
        }

        console.log(`[Permit] Generating additive permit for Batch ${batchId}...`);
        const batchTotal = await this.getBatchTotal(batchId);
        if (batchTotal === 0n) return null;

        // 1. Fetch Current On-Chain Allowance (to make it additive)
        const usdcContract = new ethers.Contract(
            this.usdcAddress,
            [
                "function nonces(address) view returns (uint256)",
                "function allowance(address, address) view returns (uint256)"
            ],
            this.provider
        );

        const currentAllowance = await usdcContract.allowance(funderAddress, this.contractAddress);
        console.log(`[Permit] Current on-chain allowance: ${ethers.formatUnits(currentAllowance, 6)} USDC`);

        // 2. Cumulative Amount = Current + New Batch
        const totalAmountToPermit = currentAllowance + batchTotal;
        console.log(`[Permit] New cumulative target: ${ethers.formatUnits(totalAmountToPermit, 6)} USDC`);

        const validitySeconds = parseInt(process.env.PERMIT_DEADLINE_SECONDS) || 3600;
        const deadline = now + validitySeconds;

        // 3. Get Nonce
        const nonce = await usdcContract.nonces(funderAddress);

        const domain = {
            name: 'USD Coin',
            version: '1',
            chainId: 137,
            verifyingContract: this.usdcAddress
        };

        const types = {
            Permit: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' }
            ]
        };

        const value = {
            owner: funderAddress,
            spender: this.contractAddress,
            value: totalAmountToPermit,
            nonce: nonce,
            deadline: deadline
        };

        const signature = await funderWallet.signTypedData(domain, types, value);
        const sig = ethers.Signature.from(signature);

        const permitData = {
            v: sig.v,
            r: sig.r,
            s: sig.s,
            deadline: deadline,
            amount: totalAmountToPermit
        };

        this.activePermits[batchId] = permitData;
        console.log(`[Permit] Batch ${batchId} additive permit active. Signed Total: ${ethers.formatUnits(totalAmountToPermit, 6)} USDC`);

        return permitData;
    }

    async syncRelayerBalance(address) {
        try {
            const balWei = await this.provider.getBalance(address);
            const balanceStr = ethers.formatEther(balWei);
            await this.pool.query(
                `UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE address = $2`,
                [balanceStr, address]
            );
            return balanceStr;
        } catch (e) {
            console.warn(`[Engine] Could not proactive-sync balance for ${address}:`, e.message);
            return null;
        }
    }

    // 1. Orchestrator: Start the Batch
    // 1. Orchestrator: Setup relayers and background the processing
    async startBatchProcessing(batchId, numRelayers) {
        console.log(`🚀 Checking for existing relayers for Batch ${batchId}...`);

        // A. Check for existing relayers in DB
        const existingRelayersRes = await this.pool.query(
            'SELECT address, private_key FROM relayers WHERE batch_id = $1 AND status = $2',
            [batchId, 'active']
        );

        let finalRelayers = [];
        let isResumption = false;

        if (existingRelayersRes.rows.length > 0) {
            console.log(`🔄 Found ${existingRelayersRes.rows.length} existing relayers. Resuming processing...`);
            finalRelayers = existingRelayersRes.rows.map(r => new ethers.Wallet(r.private_key, this.provider));
            isResumption = true;
        } else {
            console.log(`🆕 No active relayers found. Creating ${numRelayers} new ones...`);
            for (let i = 0; i < numRelayers; i++) {
                finalRelayers.push(ethers.Wallet.createRandom(this.provider));
            }
            // B. Record Relayers in DB for Audit
            await this.persistRelayers(batchId, finalRelayers);
        }

        // Background the rest (Funding + Workers)
        // Pass isResumption flag to skip redundant funding if already done
        this.backgroundProcess(batchId, finalRelayers, isResumption).catch(err => {
            console.error(`❌ Critical error in background execution for Batch ${batchId}:`, err);
        });

        const msg = isResumption ? "Processing resumed" : "Relayers setup and processing started";
        return { success: true, message: msg, count: finalRelayers.length };
    }

    async backgroundProcess(batchId, relayers, isResumption = false) {
        console.log(`[Background] Starting process for batch ${batchId} (Resumption: ${isResumption})`);

        // 1. Fetch Funder Address for this batch
        const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funderAddress = batchRes.rows[0]?.funder_address;

        if (funderAddress) {
            // 2. Setup Cumulative Permit (Shared across all workers)
            // Use FUNDER_PRIVATE_KEY or fallback to Faucet (for testing)
            const funderPk = process.env.FUNDER_PRIVATE_KEY || this.faucetWallet.privateKey;
            const funderWallet = new ethers.Wallet(funderPk, this.provider);

            if (funderWallet.address.toLowerCase() !== funderAddress.toLowerCase()) {
                console.warn(`[Permit] Warning: Funder Address in DB (${funderAddress}) does not match Funder Key in ENV (${funderWallet.address}). Permit automation might fail if they are different.`);
            }

            try {
                await this.ensureBatchPermit(batchId, funderAddress, funderWallet);
            } catch (permitErr) {
                console.error(`[Permit] Failed to prepare permit for Batch ${batchId}:`, permitErr.message);
            }
        }

        // C. Fund Relayers with Gas (Only if not resumption or if balances are 0)
        // Optimization: Single transaction batch if needed
        if (!isResumption) {
            await this.distributeGasToRelayers(batchId, relayers);
        } else {
            console.log(`[Background] Skipping gas distribution (Resumption mode).`);
            // Optional: verify balance here if we want to be super safe
        }

        // D. Launch Workers (Parallel Execution)
        const workerPromises = relayers.map(wallet => this.workerLoop(wallet, batchId));

        // E. Wait for completion
        await Promise.all(workerPromises);

        // F. Refund & Cleanup
        await this.returnFundsToFaucet(relayers, batchId);

        console.log(`✅ Batch ${batchId} Processing Complete.`);
    }

    // 2. Worker Loop (The Consumer)
    async workerLoop(wallet, batchId) {
        let processedCount = 0;
        console.log(`👷 Worker ${wallet.address.substring(0, 6)} started.`);

        while (true) {
            // Atomic DB Lock (SKIP LOCKED)
            const txReq = await this.fetchAndLockNextTx(batchId, wallet.address);

            if (!txReq) {
                // Check if we should sweep stuck transactions (Re-try Strategy)
                const stuckTx = await this.fetchStuckTx(batchId, wallet.address);
                if (stuckTx) {
                    await this.processTransaction(wallet, stuckTx, true); // retry=true
                    continue;
                }
                break; // No more work, exit loop
            }

            // Process Normal Transaction
            await this.processTransaction(wallet, txReq, false);
            processedCount++;
        }
        console.log(`Unknown Worker ${wallet.address.substring(0, 6)} finished. Processed: ${processedCount}`);
    }

    // 3. Queue Logic (SKIP LOCKED)
    async fetchAndLockNextTx(batchId, relayerAddr) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const res = await client.query(`
                UPDATE batch_transactions
                SET status = 'SENDING_RPC', relayer_address = $1, updated_at = NOW()
                WHERE id = (
                    SELECT id FROM batch_transactions
                    WHERE batch_id = $2 AND status = 'PENDING'
                    ORDER BY id ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING *
            `, [relayerAddr, batchId]);
            await client.query('COMMIT');
            return res.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Queue Lock Error", e);
            return null;
        } finally {
            client.release();
        }
    }

    /**
     * Fetches Merkle proof for a specific transaction in a batch.
     */
    async getMerkleProof(batchId, transactionId) {
        const proofRes = await this.pool.query(
            `SELECT hash, position_index, level FROM merkle_nodes WHERE batch_id = $1 AND level = 0 AND transaction_id = $2`,
            [batchId, transactionId]
        );
        if (proofRes.rows.length === 0) return [];

        let currentHash = proofRes.rows[0].hash;
        const proof = [];

        // Fetch sibling hashes level by level
        let level = 0;
        while (true) {
            const nodeRes = await this.pool.query(
                `SELECT hash, parent_hash, position_index FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND hash = $3`,
                [batchId, level, currentHash]
            );
            if (nodeRes.rows.length === 0) break;

            const node = nodeRes.rows[0];
            const parentHash = node.parent_hash;
            if (!parentHash) break; // Reached Root

            // Sibling is the other child of the same parent
            const siblingRes = await this.pool.query(
                `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND parent_hash = $3 AND hash != $4`,
                [batchId, level, parentHash, currentHash]
            );

            if (siblingRes.rows.length > 0) {
                proof.push(siblingRes.rows[0].hash);
            } else {
                // Odd node at this level, sibling is itself (duplication logic)
                proof.push(currentHash);
            }

            currentHash = parentHash;
            level++;
        }
        return proof;
    }

    // 4. Process Logic (Sign & Send)
    async processTransaction(wallet, txDB, isRetry) {
        try {
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, wallet);

            const network = await this.provider.getNetwork();
            const chainId = network.chainId;

            // FETCH REAL PROOF from DB
            const proof = await this.getMerkleProof(txDB.batch_id, txDB.id);
            if (proof.length === 0) {
                console.warn(`[Engine] No proof found for tx ${txDB.id} in batch ${txDB.batch_id}. This will likely revert.`);
            }

            const txRes = await this.pool.query('SELECT amount_usdc, wallet_address_to, batch_id FROM batch_transactions WHERE id = $1', [txDB.id]);
            const batchTx = txRes.rows[0];
            const amountVal = ethers.parseUnits(batchTx.amount_usdc.toString(), 6);

            // Double check leaf local generation for audit
            const abiCoder = ethers.AbiCoder.defaultAbiCoder();
            const funderRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [txDB.batch_id]);
            const funder = funderRes.rows[0].funder_address;

            const encodedData = abiCoder.encode(
                ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                [chainId, this.contractAddress, BigInt(txDB.batch_id), BigInt(txDB.id), funder, txDB.wallet_address_to, amountVal]
            );
            const leaf = ethers.keccak256(encodedData);
            console.log(`[Engine] Worker ${wallet.address.substring(0, 6)} | Processing Leaf: ${leaf} | Proof Len: ${proof.length}`);

            // PER-BATCH PERMIT: Get shared signature for this batch
            const permit = this.activePermits[txDB.batch_id];

            let txResponse;

            if (permit) {
                console.log(`[Engine] Executing with Permit for Batch ${txDB.batch_id} (TX #${txDB.id})`);
                // Estimate Gas for executeWithPermit
                const gasLimit = await contract.executeWithPermit.estimateGas(
                    txDB.batch_id, txDB.id, funder, batchTx.wallet_address_to, amountVal, proof,
                    permit.deadline, permit.v, permit.r, permit.s
                );

                txResponse = await contract.executeWithPermit(
                    txDB.batch_id,
                    txDB.id,
                    funder,
                    batchTx.wallet_address_to,
                    amountVal,
                    proof,
                    permit.deadline,
                    permit.v,
                    permit.r,
                    permit.s,
                    { gasLimit: gasLimit * 120n / 100n } // 20% buffer
                );
            } else {
                console.log(`[Engine] Executing Standard for Batch ${txDB.batch_id} (TX #${txDB.id})`);
                // Fallback to standard execution (requires manual allowance)
                const gasLimit = await contract.executeTransaction.estimateGas(
                    txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof
                );

                txResponse = await contract.executeTransaction(
                    txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof,
                    { gasLimit: gasLimit * 120n / 100n }
                );
            }

            console.log(`Tx SENT: ${txResponse.hash}. Waiting for confirmation...`);
            await txResponse.wait();
            console.log(`Tx CONFIRMED: ${txResponse.hash}`);

            await this.pool.query(
                `UPDATE batch_transactions SET status = 'SENT', tx_hash = $1, updated_at = NOW() WHERE id = $2`,
                [txResponse.hash, txDB.id]
            );

            // Update Relayer Last Activity & Balance (PROACTIVE)
            await this.syncRelayerBalance(wallet.address);
        } catch (e) {
            if (e.message && e.message.includes("Tx already executed")) {
                console.log(`⚠️ Tx ${txDB.id} already on-chain. Recovered.`);
                await this.pool.query(`UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = 'RECOVERED', updated_at = NOW() WHERE id = $1`, [txDB.id]);
                return;
            }
            console.error(`Tx Failed: ${txDB.id}`, e);
            await this.pool.query(`UPDATE batch_transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [txDB.id]);
        }
    }

    // 8. Estimate total gas for a batch using statistical sampling (FAST)
    async estimateBatchGas(batchId) {
        const startTime = Date.now();
        console.log(`[Estimate] Starting optimization for batch ${batchId}`);

        // Fetch all pending transactions for the batch
        const txRes = await this.pool.query('SELECT id, amount_usdc, wallet_address_to FROM batch_transactions WHERE batch_id = $1 AND status = $2', [batchId, 'PENDING']);
        const txs = txRes.rows;
        const totalCount = txs.length;

        console.log(`[Estimate] Found ${totalCount} transactions in batch ${batchId}`);
        if (totalCount === 0) return { totalGas: 0n, totalCostWei: 0n };

        const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funder = batchRes.rows[0]?.funder_address || ethers.ZeroAddress;
        const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);

        // Sampling Strategy: Estimate first 5 transactions to get an average
        const sampleSize = Math.min(5, totalCount);
        const sampleTxs = txs.slice(0, sampleSize);

        console.log(`[Estimate] Estimating sample of ${sampleSize} transactions...`);

        const sampleEstimates = await Promise.all(sampleTxs.map(async (tx) => {
            const amountVal = ethers.parseUnits(tx.amount_usdc.toString(), 6);
            const proof = [ethers.ZeroHash]; // Placeholder proof for estimation
            try {
                return await contract.executeTransaction.estimateGas(
                    batchId, tx.id, funder, tx.wallet_address_to, amountVal, proof
                );
            } catch (e) {
                // Return a safe conservative estimate for USDC transfers + logic overhead
                return 150000n;
            }
        }));

        const totalSampleGas = sampleEstimates.reduce((acc, val) => acc + val, 0n);
        const averageGas = totalSampleGas / BigInt(sampleSize);
        const extrapolatedTotalGas = averageGas * BigInt(totalCount);

        // Add 20% buffer for safety (reduced from 50% to avoid extreme overfunding)
        const bufferedGas = extrapolatedTotalGas * 120n / 100n;

        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n; // fallback to 50 gwei (standard for Polygon)
        const totalCostWei = bufferedGas * gasPrice;

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[Estimate] COMPLETED in ${duration}s. Total extrapolated gas: ${extrapolatedTotalGas}. Buffered: ${bufferedGas}. Total: ${ethers.formatEther(totalCostWei)} MATIC`);

        return { totalGas: bufferedGas, totalCostWei };
    }

    // 9. Distribute buffered gas cost equally among relayers
    async distributeGasToRelayers(batchId, relayers) {
        const { totalCostWei } = await this.estimateBatchGas(batchId);
        if (relayers.length === 0) return;
        const perRelayerWei = totalCostWei / BigInt(relayers.length);
        console.log(`🪙 Distributing ${ethers.formatEther(perRelayerWei)} MATIC to each of ${relayers.length} relayers`);
        await this.fundRelayers(relayers, perRelayerWei);
    }

    // Optimized funding logic using Single Transaction Batch (distributeMatic)
    async fundRelayers(relayers, amountWei) {
        if (!amountWei || amountWei === 0n) {
            console.log(`[Fund] Funding skipped: amount is zero or undefined.`);
            return;
        }

        const faucetAddr = this.faucetWallet.address;
        const faucetBal = await this.provider.getBalance(faucetAddr);
        const count = relayers.length;
        const totalValueToSend = amountWei * BigInt(count);

        console.log(`[Fund] Faucet ${faucetAddr} | Balance: ${ethers.formatEther(faucetBal)} MATIC`);
        console.log(`[Fund] Required Total: ${ethers.formatEther(totalValueToSend)} MATIC for ${count} relayers.`);

        if (faucetBal < totalValueToSend) {
            console.error(`❌ Faucet has INSUFFICIENT FUNDS. Funding will likely fail.`);
            // Continue anyway to see explicit revert reason, or handle gracefully
        }

        const addresses = relayers.map(r => r.address);

        try {
            console.log(`[Fund] Sending Atomic Distribution via Smart Contract: ${this.contractAddress}...`);
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.faucetWallet);

            // Fetch current fee data
            const feeData = await this.provider.getFeeData();
            // Use legacy gasPrice if EIP-1559 fees are missing for stability on some RPCs
            const overrides = {
                value: totalValueToSend,
                gasLimit: 80000n * BigInt(count) + 100000n // More accurate batch limit
            };

            if (feeData.maxFeePerGas) {
                overrides.maxFeePerGas = feeData.maxFeePerGas * 120n / 100n;
                overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas * 150n / 100n;
            } else {
                overrides.gasPrice = feeData.gasPrice ? (feeData.gasPrice * 120n / 100n) : 50000000000n;
            }

            const tx = await contract.distributeMatic(addresses, amountWei, overrides);

            console.log(`[Fund] Atomic Batch Tx SENT: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`[Fund] Atomic Batch Tx CONFIRMED in block ${receipt.blockNumber}!`);

            // Proactive sync for all
            await Promise.all(relayers.map(r => this.syncRelayerBalance(r.address)));

        } catch (err) {
            console.error(`❌ Atomic batch funding failed:`, err.message);
            console.log(`⚠️ Entering Sequential Fallback...`);

            // Fallback to manual sequential
            let nonce = await this.faucetWallet.getNonce();
            for (const r of relayers) {
                try {
                    // Check if relayer already has enough balance to skip
                    const relBal = await this.provider.getBalance(r.address);
                    if (relBal >= amountWei) {
                        console.log(`   ⏭️ Skipping ${r.address.substring(0, 8)} (already has ${ethers.formatEther(relBal)} MATIC)`);
                        continue;
                    }

                    const tx = await this.faucetWallet.sendTransaction({
                        to: r.address,
                        value: amountWei,
                        nonce: nonce++,
                        gasLimit: 21000n
                    });
                    console.log(`   ✅ Sequential sent to ${r.address.substring(0, 8)}: ${tx.hash}`);
                    this.trackFallbackTx(tx, r.address);
                } catch (ser) {
                    console.error(`   ❌ Fallback failed for ${r.address}:`, ser.message);
                }
            }
        }
    }

    // Helper for non-blocking tracking
    async trackFallbackTx(tx, address) {
        try {
            await tx.wait();
            await this.syncRelayerBalance(address);
        } catch (e) {
            console.warn(`[Fund] Fallback tracking failed for ${address}`);
        }
    }

    // 6. Persistence
    async persistRelayers(batchId, relayers) {
        console.log(`Persisting ${relayers.length} relayers for batch ${batchId}...`);
        try {
            for (const r of relayers) {
                await this.pool.query(
                    `INSERT INTO relayers (batch_id, address, private_key, status) VALUES ($1, $2, $3, 'active')`,
                    [batchId, r.address, r.privateKey]
                );
            }
            console.log("✅ Relayers persisted to DB.");
        } catch (err) {
            console.error("❌ Failed to persist relayers:", err);
            throw err; // Re-throw to stop process if persistence fails
        }
    }

    // 7. Refund Logic: Parallel Sweep back to Faucet
    async returnFundsToFaucet(relayers, batchId) {
        console.log(`[Refund] Starting sweep for ${relayers.length} relayers in Batch ${batchId}...`);

        const faucetAddress = this.faucetWallet.address;
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n; // 35 gwei fallback
        const gasLimit = 21000n; // Standard transfer
        const costWei = gasLimit * gasPrice;

        const refundPromises = relayers.map(async (r) => {
            try {
                const wallet = new ethers.Wallet(r.privateKey, this.provider);
                const balance = await this.provider.getBalance(wallet.address);

                // Dust Protection: Only refund if balance > cost + 0.01 MATIC buffer
                const buffer = ethers.parseEther("0.01");
                if (balance > (costWei + buffer)) {
                    const amountToReturn = balance - costWei;
                    console.log(`[Refund] Sweeping ${ethers.formatEther(amountToReturn)} MATIC from ${wallet.address.substring(0, 6)}...`);

                    const tx = await wallet.sendTransaction({
                        to: faucetAddress,
                        value: amountToReturn,
                        gasLimit: gasLimit,
                        gasPrice: gasPrice
                    });

                    return tx.hash;
                } else {
                    console.log(`[Refund] Skipping ${wallet.address.substring(0, 6)}: Balance too low (${ethers.formatEther(balance)} MATIC)`);
                    return null;
                }
            } catch (err) {
                console.warn(`[Refund] Failed for relayer ${r.address.substring(0, 6)}:`, err.message);
                return null;
            }
        });

        const hashes = await Promise.all(refundPromises);
        const successful = hashes.filter(h => h !== null).length;

        console.log(`[Refund] Sweep complete for Batch ${batchId}. ${successful}/${relayers.length} relayers returned funds.`);

        // Update DB status
        await this.pool.query(`UPDATE relayers SET status = 'drained', last_activity = NOW() WHERE batch_id = $1`, [batchId]);
    }

    // Sweep Logic: Detect Zombies
    async fetchStuckTx(batchId, relayerAddr) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // Select stuck transaction (older than 2 mins)
            const res = await client.query(`
                UPDATE batch_transactions
                SET status = 'SENDING_RPC', relayer_address = $1, updated_at = NOW()
                WHERE id = (
                    SELECT id FROM batch_transactions
                    WHERE batch_id = $2 
                      AND status IN ('SENDING_RPC', 'FAILED')
                      AND updated_at < NOW() - INTERVAL '2 MINUTES'
                    ORDER BY id ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING *
            `, [relayerAddr, batchId]);
            await client.query('COMMIT');
            if (res.rows.length > 0) {
                console.log(`🧹 ZOMBIE DETECTED! Rescuing Tx ${res.rows[0].id}`);
            }
            return res.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Sweep Lock Error", e);
            return null;
        } finally {
            client.release();
        }
    }
}

module.exports = RelayerEngine;
