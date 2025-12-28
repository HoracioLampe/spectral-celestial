const ethers = require('ethers');

// Relayer Engine for High Throughput Processing
class RelayerEngine {
    constructor(pool, providerUrl, faucetPrivateKey) {
        this.pool = pool; // Postgres Pool
        this.provider = new ethers.JsonRpcProvider(providerUrl, undefined, {
            staticNetwork: true
        });
        this.faucetWallet = new ethers.Wallet(faucetPrivateKey, this.provider);
        this.cachedChainId = null;

        // Configuration
        this.contractAddress = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
        this.usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

        this.contractABI = [
            "function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external",
            "function executeWithPermit(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
            "function processedLeaves(bytes32) view returns (bool)",
            "function distributeMatic(address[] calldata recipients, uint256 amount) external payable",
            "function setBatchRoot(uint256 batchId, bytes32 merkleRoot) external",
            "function setBatchRootWithSignature(address funder, uint256 batchId, bytes32 merkleRoot, uint256 totalTransactions, uint256 totalAmount, bytes calldata signature) external",
            "function batchRoots(address funder, uint256 batchId) view returns (bytes32)"
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
        return BigInt(total);
    }

    /**
     * Generates or retrieves a valid permit signature for a specific batch.
     */
    // (REMOVED ensureBatchPermit as we use Direct Permit Submission)

    async syncRelayerBalance(address) {
        try {
            await new Promise(r => setTimeout(r, 100)); // Throttle
            const balWei = await this.provider.getBalance(address);
            const balanceStr = ethers.formatEther(balWei);
            await this.pool.query(
                `UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE address = $2`,
                [balanceStr, address]
            );
            return balanceStr;
        } catch (e) {
            console.warn(`[Engine] Could not proactive-sync balance for ${address}: `, e.message);
            return null;
        }
    }

    /**
     * PHASE 1: Setup relayers and fund them.
     */
    async prepareRelayers(batchId, numRelayers) {
        console.log(`[Engine] 🏗️ prepareRelayers(id = ${batchId}, count = ${numRelayers})`);

        // Check for existing relayers in DB
        const existingRelayersRes = await this.pool.query(
            'SELECT address, private_key FROM relayers WHERE batch_id = $1',
            [batchId]
        );

        let relayers = [];
        if (existingRelayersRes.rows.length > 0) {
            console.log(`[Engine] Found ${existingRelayersRes.rows.length} existing relayers for Batch ${batchId}.`);
            relayers = existingRelayersRes.rows.map(r => new ethers.Wallet(r.private_key, this.provider));
        } else {
            console.log(`[Engine] Creating ${numRelayers} new relayers...`);
            for (let i = 0; i < numRelayers; i++) {
                // Ethers v6: createRandom() does not take provider. 
                // We connect it later or just use it for the PK/Address.
                const wallet = ethers.Wallet.createRandom();
                const connectedWalllet = wallet.connect(this.provider);
                relayers.push(connectedWalllet);

                if ((i + 1) % 5 === 0 || (i + 1) === numRelayers) {
                    console.log(`[Engine] Created ${i + 1}/${numRelayers} relayers...`);
                }
            }
            await this.persistRelayers(batchId, relayers);
        }

        // Trigger Atomic Funding
        console.log(`[Engine] Funding ${relayers.length} relayers for Batch ${batchId}...`);
        await this.distributeGasToRelayers(batchId, relayers);
        console.log(`[Engine] ✅ Relayer setup and funding COMPLETE for Batch ${batchId}.`);

        return { success: true, count: relayers.length };
    }

    /**
     * PHASE 2: Consume signatures and start the swarm.
     */
    async startExecution(batchId, permitData = null, rootSignatureData = null) {
        console.log(`[Engine] 🚀 startExecution(id = ${batchId}, hasPermit=${!!permitData}, hasRootSig=${!!rootSignatureData})`);

        const relayersRes = await this.pool.query(
            'SELECT address, private_key FROM relayers WHERE batch_id = $1',
            [batchId]
        );

        if (relayersRes.rows.length === 0) {
            throw new Error("Relayers not prepared. Run setup first.");
        }

        const relayers = relayersRes.rows.map(r => {
            const w = new ethers.Wallet(r.private_key, this.provider);
            w.batch_id = batchId;
            return w;
        });

        // Background the execution
        this.backgroundProcess(batchId, relayers, true, permitData, rootSignatureData).catch(err => {
            console.error(`❌ Critical error in background execution for Batch ${batchId}: `, err);
        });

        return { success: true, message: "Execution started in background" };
    }

    async backgroundProcess(batchId, relayers, isResumption = false, externalPermit = null, rootSignatureData = null) {
        console.log(`[Background] 🎬 START | Batch: ${batchId} | Relayers: ${relayers.length} | Resumption: ${isResumption} | ExternalPermit: ${!!externalPermit} | RootSig: ${!!rootSignatureData}`);

        // 1. Fetch Funder Address for this batch
        const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funderAddress = batchRes.rows[0]?.funder_address;

        if (funderAddress) {
            // --- 1.1 VERIFY ON-CHAIN ROOT ---
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);
            const onChainRoot = await contract.batchRoots(funderAddress, batchId);

            // Get Backend Root
            const dbBatchRes = await this.pool.query('SELECT merkle_root FROM batches WHERE id = $1', [batchId]);
            const dbRoot = dbBatchRes.rows[0]?.merkle_root;

            console.log(`[Engine] 🔍 P-Check Root: Chain=${onChainRoot} vs DB=${dbRoot}`);

            if (onChainRoot === ethers.ZeroHash) {
                console.log(`[Engine] ⚠️ Root NOT set on-chain.`);

                if (rootSignatureData) {
                    try {
                        console.log(`[Engine][Root] 📝 PREPARING MERKLE ROOT REGISTRATION:`);
                        console.log(`   > Batch ID:    ${batchId}`);
                        console.log(`   > Funder:      ${rootSignatureData.funder}`);
                        console.log(`   > Merkle Root: ${rootSignatureData.merkleRoot}`);
                        console.log(`   > Executor:    ${this.faucetWallet.address} (Faucet)`);

                        const writerContract = contract.connect(this.faucetWallet);
                        const tx = await writerContract.setBatchRootWithSignature(
                            rootSignatureData.funder,
                            BigInt(batchId),
                            rootSignatureData.merkleRoot,
                            BigInt(rootSignatureData.totalTransactions),
                            BigInt(rootSignatureData.totalAmount),
                            rootSignatureData.signature
                        );
                        console.log(`[Blockchain][Root] 🚀 Registration TX Sent: ${tx.hash}`);

                        const receipt = await tx.wait();
                        console.log(`[Blockchain][Root] ✅ Registration CONFIRMED (Block: ${receipt.blockNumber})`);
                    } catch (rootErr) {
                        console.error(`[Engine] ❌ Failed to set batch root via signature: ${rootErr.message}`);
                        throw new Error(`Failed to set Batch Root: ${rootErr.message}`);
                    }
                } else {
                    console.error(`[Engine] ⛔ CRITICAL: Root not set and no signature provided.`);
                    throw new Error("Batch Root not registered on-chain. Please sign the root in the UI.");
                }
            } else {
                // Root is set. Verify match.
                if (dbRoot && onChainRoot !== dbRoot) {
                    console.error(`[Engine] ⛔ CRITICAL: Root Mismatch! DB: ${dbRoot} vs Chain: ${onChainRoot}`);
                    throw new Error(`Merkle Root Mismatch. Contact Support.`);
                }
                console.log(`[Engine] ✅ Root verified on-chain.`);
            }

            // --- 1.2 FETCH ALLOWANCE & BALANCE (v2.2.8 Added Visibility) ---
            try {
                const usdc = new ethers.Contract(this.usdcAddress, [
                    "function allowance(address,address) view returns (uint256)",
                    "function balanceOf(address) view returns (uint256)"
                ], this.provider);
                const allowance = await usdc.allowance(funderAddress, this.contractAddress);
                const balance = await usdc.balanceOf(funderAddress);
                console.log(`[Permit] Funder: ${funderAddress}`);
                console.log(`         Balance:   ${balance.toString()} raw | ${ethers.formatUnits(balance, 6)} USDC`);
                console.log(`         Allowance: ${allowance.toString()} raw | ${ethers.formatUnits(allowance, 6)} USDC`);

                if (allowance === 0n && !externalPermit) {
                    console.warn(`[Permit] ⚠️ Zero allowance and no permit provided. Transactions will fail unless a permit or manual approval is executed.`);
                }
            } catch (err) {
                console.warn(`[Permit] Could not fetch on-chain allowance/balance: ${err.message}`);
            }

            // 1.3 Handle Permit (Direct submission to USDC contract)
            if (externalPermit) {
                console.log(`[Engine][Permit] 📩 Submitting Client Permit for Batch ${batchId} directly to USDC contract...`);
                try {
                    const usdc = new ethers.Contract(this.usdcAddress, [
                        "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
                        "function allowance(address, address) view returns (uint256)"
                    ], this.faucetWallet);

                    const tx = await usdc.permit(
                        externalPermit.owner || funderAddress,
                        this.contractAddress,
                        BigInt(externalPermit.amount),
                        BigInt(externalPermit.deadline),
                        externalPermit.v,
                        externalPermit.r,
                        externalPermit.s
                    );
                    console.log(`[Blockchain][Permit] 🚀 Permit TX Sent: ${tx.hash}`);
                    const receipt = await tx.wait();
                    console.log(`[Blockchain][Permit] ✅ Permit CONFIRMED (Block: ${receipt.blockNumber})`);
                } catch (permitErr) {
                    console.error(`[Engine][Permit] ❌ Failed to submit permit: ${permitErr.message}`);
                    // We don't throw yet, maybe allowance was already set or it's a retry
                }
            } else if (process.env.FUNDER_PRIVATE_KEY) {
                console.log(`[Engine][Permit] FUNDER_PRIVATE_KEY detected, but server-side permit generation is deprecated. Please sign via UI.`);
            }
        }

        // --- C. DELAYED FUNDING ---
        let needsFunding = !isResumption;
        if (isResumption && relayers.length > 0) {
            const firstRelBal = await this.provider.getBalance(relayers[0].address);
            if (firstRelBal < ethers.parseEther("0.01")) needsFunding = true;
        }

        if (needsFunding) {
            console.log(`[Background] Triggering distributeGasToRelayers...`);
            await this.distributeGasToRelayers(batchId, relayers);
        }

        // --- E. PHASE 2: PARALLEL SWARM ---
        console.log(`[Background] 🚀 Launching Parallel Workers...`);
        // Add a slight stagger to avoid all workers hitting node at exact same ms
        const workerPromises = relayers.map((wallet, idx) => {
            return new Promise(resolve => {
                setTimeout(() => resolve(this.workerLoop(wallet, batchId)), idx * 500);
            });
        });

        await Promise.all(workerPromises);

        // G. Refund & Cleanup
        await this.returnFundsToFaucet(relayers, batchId);
        console.log(`✅ Batch ${batchId} Processing Complete.`);
    }

    // 2. Worker Loop (The Consumer)
    async workerLoop(wallet, batchId) {
        let processedCount = 0;
        let totalGasWei = 0n;
        const startBal = await this.provider.getBalance(wallet.address);
        console.log(`👷 Worker ${wallet.address.substring(0, 6)} started | Relayer: ${wallet.address} | Balance: ${ethers.formatEther(startBal)} MATIC`);

        while (true) {
            const txReq = await this.fetchAndLockNextTx(batchId, wallet.address);

            if (!txReq) {
                const stuckTx = await this.fetchStuckTx(batchId, wallet.address);
                if (stuckTx) {
                    await this.processTransaction(wallet, stuckTx, true);
                    continue;
                }
                break;
            }

            const res = await this.processTransaction(wallet, txReq, false);
            if (res.gasUsed && res.effectiveGasPrice) {
                totalGasWei += (res.gasUsed * res.effectiveGasPrice);
            }
            processedCount++;
            // Throttle worker to avoid smashing RPC
            await new Promise(r => setTimeout(r, 300));
        }

        // Save total gas spent by this worker
        await this.pool.query(
            `UPDATE relayers SET gas_cost = $1 WHERE address = $2 AND batch_id = $3`,
            [ethers.formatEther(totalGasWei), wallet.address, batchId]
        );

        console.log(`👷 Worker ${wallet.address.substring(0, 6)} finished. Processed: ${processedCount} | Gas: ${ethers.formatEther(totalGasWei)} MATIC`);
    }

    // 3. Queue Logic (SKIP LOCKED)
    async fetchAndLockNextTx(batchId, relayerAddr) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const res = await client.query(`
                UPDATE batch_transactions
                SET status = 'ENVIANDO', relayer_address = $1, updated_at = NOW()
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

    async getMerkleProof(batchId, transactionId) {
        const startRes = await this.pool.query(
            `SELECT position_index, hash FROM merkle_nodes WHERE batch_id = $1 AND level = 0 AND transaction_id = $2`,
            [batchId, transactionId]
        );
        if (startRes.rows.length === 0) return [];

        const maxLevelRes = await this.pool.query(
            `SELECT MAX(level) as max_level FROM merkle_nodes WHERE batch_id = $1`,
            [batchId]
        );
        const maxLevel = maxLevelRes.rows[0].max_level;
        if (maxLevel === undefined || maxLevel === null) return [];

        let currentIndex = startRes.rows[0].position_index;
        const proof = [];

        for (let level = 0; level < maxLevel; level++) {
            const siblingIndex = currentIndex ^ 1;
            const siblingRes = await this.pool.query(
                `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
                [batchId, level, siblingIndex]
            );

            if (siblingRes.rows.length > 0) {
                proof.push(siblingRes.rows[0].hash);
            } else {
                const currentRes = await this.pool.query(
                    `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
                    [batchId, level, currentIndex]
                );
                if (currentRes.rows.length > 0) {
                    proof.push(currentRes.rows[0].hash);
                }
            }
            currentIndex = currentIndex >> 1;
        }
        return proof;
    }

    async processTransaction(wallet, txDB, isRetry) {
        try {
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, wallet);

            if (!this.cachedChainId) {
                const network = await this.provider.getNetwork();
                this.cachedChainId = network.chainId;
            }
            const chainId = this.cachedChainId;

            const proof = await this.getMerkleProof(txDB.batch_id, txDB.id);
            const amountVal = BigInt(txDB.amount_usdc);

            const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [txDB.batch_id]);
            const funder = batchRes.rows[0].funder_address;

            console.log(`[Engine] Executing Standard for Batch ${txDB.batch_id} (TX #${txDB.id})`);
            const gasLimit = await contract.executeTransaction.estimateGas(
                txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof
            );
            const txResponse = await contract.executeTransaction(
                txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof,
                { gasLimit: gasLimit * 125n / 100n }
            );

            console.log(`[Blockchain][Tx] SENT: ${txResponse.hash} | TxID: ${txDB.id} | From: ${wallet.address}`);
            await txResponse.wait();
            console.log(`[Blockchain][Tx] CONFIRMED: ${txResponse.hash} | Batch: ${txDB.batch_id} | TxID: ${txDB.id}`);

            await this.pool.query(
                `UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = $1, amount_transferred = $2, updated_at = NOW() WHERE id = $3`,
                [txResponse.hash, txDB.amount_usdc.toString(), txDB.id]
            );
            await this.syncRelayerBalance(wallet.address);

            // Return receipt data so worker can track gas
            const receipt = await this.provider.getTransactionReceipt(txResponse.hash);
            return { success: true, txHash: txResponse.hash, gasUsed: receipt ? receipt.gasUsed : 0n, effectiveGasPrice: receipt ? receipt.effectiveGasPrice : 0n };
        } catch (e) {
            if (e.message && e.message.includes("Tx already executed")) {
                console.log(`⚠️ Tx ${txDB.id} already on-chain. Recovered.`);
                await this.pool.query(`UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = 'RECOVERED', updated_at = NOW() WHERE id = $1`, [txDB.id]);
                return { success: true, txHash: 'RECOVERED', gasUsed: 0n, effectiveGasPrice: 0n };
            }
            console.error(`Tx Failed: ${txDB.id}`, e.message);
            await this.pool.query(`UPDATE batch_transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [txDB.id]);
            return { success: false, error: e.message };
        }
    }

    async estimateBatchGas(batchId) {
        console.log(`[Engine] ⛽ Estimating gas for Batch ${batchId}...`);
        const txRes = await this.pool.query('SELECT id, amount_usdc, wallet_address_to FROM batch_transactions WHERE batch_id = $1 AND status = $2', [batchId, 'PENDING']);
        const txs = txRes.rows;
        if (txs.length === 0) {
            console.log(`[Engine]   > No pending transactions found for estimation.`);
            return { totalCostWei: 0n };
        }

        const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funder = batchRes.rows[0]?.funder_address || ethers.ZeroAddress;

        const sampleSize = Math.min(3, txs.length);
        const sampleTxs = txs.slice(0, sampleSize);
        let totalSampleGas = 0n;

        const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);
        for (const tx of sampleTxs) {
            try {
                const gas = await contract.executeTransaction.estimateGas(
                    batchId, tx.id, funder, tx.wallet_address_to, BigInt(tx.amount_usdc), [ethers.ZeroHash]
                );
                totalSampleGas += gas;
                console.log(`[Engine]   > Sample Tx ${tx.id} gas: ${gas.toString()}`);
            } catch (e) {
                console.warn(`[Engine]   > Sample Tx ${tx.id} estimation failed, using fallback 150k. Error: ${e.message}`);
                totalSampleGas += 150000n;
            }
        }

        const averageGas = totalSampleGas / BigInt(sampleSize);
        const bufferedGas = (averageGas * BigInt(txs.length)) * 130n / 100n;
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n;
        const totalCost = bufferedGas * gasPrice;

        console.log(`[Engine]   > Total estimated cost: ${ethers.formatEther(totalCost)} MATIC`);
        return { totalCostWei: totalCost };
    }

    async distributeGasToRelayers(batchId, relayers) {
        const { totalCostWei } = await this.estimateBatchGas(batchId);
        if (relayers.length === 0 || totalCostWei === 0n) return;

        const perRelayerWei = totalCostWei / BigInt(relayers.length);
        console.log(`🪙 [Background] Funding: ${ethers.formatEther(totalCostWei)} MATIC total (${ethers.formatEther(perRelayerWei)} per relayer)`);
        await this.fundRelayers(batchId, relayers, perRelayerWei);
    }

    async fundRelayers(batchId, relayers, amountWei) {
        if (!amountWei || amountWei === 0n) return;

        try {
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.faucetWallet);
            const totalValueToSend = amountWei * BigInt(relayers.length);

            // Check Faucet Balance
            const faucetBalance = await this.provider.getBalance(this.faucetWallet.address);
            console.log(`[Engine][Fund] Faucet Balance: ${ethers.formatEther(faucetBalance)} MATIC`);
            if (faucetBalance < totalValueToSend) {
                throw new Error(`Insufficient Faucet balance. Need ${ethers.formatEther(totalValueToSend)} MATIC, have ${ethers.formatEther(faucetBalance)}.`);
            }

            console.log(`[Engine][Fund] 🚀 Atomic Distribution START: ${relayers.length} relayers.`);
            console.log(`[Engine][Fund] Target: ${ethers.formatEther(amountWei)} MATIC each | Total: ${ethers.formatEther(totalValueToSend)} MATIC`);

            // Gas Calculation: Baseline (100k) + ~30k per recipient (typical for a loop of calls/transfers)
            const safeGasLimit = 150000n + (BigInt(relayers.length) * 35000n);

            const tx = await contract.distributeMatic(
                relayers.map(r => r.address),
                amountWei,
                {
                    value: totalValueToSend,
                    gasLimit: safeGasLimit
                }
            );

            console.log(`[Blockchain][Fund] Atomic Batch SENT: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`[Blockchain][Fund] Atomic Batch CONFIRMED (Block: ${receipt.blockNumber})`);

            await Promise.all(relayers.map(r =>
                this.pool.query(`UPDATE relayers SET transactionhash_deposit = $1 WHERE address = $2 AND batch_id = $3`, [tx.hash, r.address, batchId])
            ));
            await Promise.all(relayers.map(r => this.syncRelayerBalance(r.address)));
        } catch (err) {
            console.error(`❌ Atomic funding FAILED:`, err.message);
            console.log(`⚠️ Falling back to sequential distribution due to: ${err.reason || err.code || 'Unknown Error'}`);

            let nonce = await this.faucetWallet.getNonce();
            for (const r of relayers) {
                try {
                    await new Promise(res => setTimeout(res, 500)); // Throttling
                    const tx = await this.faucetWallet.sendTransaction({
                        to: r.address,
                        value: amountWei,
                        nonce: nonce++,
                        gasLimit: 21000n
                    });
                    await tx.wait();
                    await this.pool.query(`UPDATE relayers SET transactionhash_deposit = $1 WHERE address = $2 AND batch_id = $3`, [tx.hash, r.address, batchId]);
                    await this.syncRelayerBalance(r.address);
                } catch (ser) {
                    console.error(`   ❌ Fallback failed for ${r.address}:`, ser.message);
                }
            }
        }
    }

    async persistRelayers(batchId, relayers) {
        console.log(`[Engine] 💾 Persisting ${relayers.length} relayers to database...`);
        for (let i = 0; i < relayers.length; i++) {
            const r = relayers[i];
            try {
                await this.pool.query(
                    `INSERT INTO relayers(batch_id, address, private_key, status) 
                     VALUES($1, $2, $3, 'active')
                     ON CONFLICT (address) DO UPDATE SET batch_id = EXCLUDED.batch_id, status = 'active'`,
                    [batchId, r.address, r.privateKey]
                );
                if ((i + 1) % 10 === 0 || (i + 1) === relayers.length) {
                    console.log(`[Engine]   > Saved ${i + 1}/${relayers.length} relayers.`);
                }
            } catch (err) {
                console.warn(`[Engine] Skip/Update existing relayer ${r.address}: ${err.message}`);
            }
        }
        console.log(`[Engine] ✅ Persistence done.`);
    }

    async returnFundsToFaucet(relayers, batchId) {
        const faucetAddress = this.faucetWallet.address;
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 40000000000n;
        const costWei = 21000n * gasPrice;
        const safetyBuffer = ethers.parseEther("0.002"); // Leave 0.002 MATIC for safety

        // Wait for RPC convergence after mass transactions
        console.log("⏳ Waiting 5s for RPC balance convergence...");
        await new Promise(r => setTimeout(r, 5000));

        const promises = relayers.map(async (r, idx) => {
            try {
                // Throttle specifically for fund return to avoid rate limits
                await new Promise(res => setTimeout(res, idx * 1000));

                const wallet = new ethers.Wallet(r.privateKey, this.provider);
                const bal = await this.provider.getBalance(wallet.address);

                // Record final balance before drain
                await this.pool.query(
                    `UPDATE relayers SET drain_balance = $1 WHERE address = $2 AND batch_id = $3`,
                    [ethers.formatEther(bal), r.address, batchId]
                );

                if (bal > (costWei + safetyBuffer)) {
                    const amount = bal - costWei - safetyBuffer;
                    const tx = await wallet.sendTransaction({ to: faucetAddress, value: amount, gasLimit: 21000n, gasPrice });
                    await tx.wait();
                    console.log(`[Refund] Successfully returned ${ethers.formatEther(amount)} from ${r.address.substring(0, 6)}`);
                    return tx.hash;
                }
            } catch (err) {
                console.warn(`[Refund] Failed for ${r.address.substring(0, 6)}:`, err.message);
            }
            return null;
        });

        await Promise.all(promises);
        await this.pool.query(`UPDATE relayers SET status = 'drained', last_activity = NOW() WHERE batch_id = $1`, [batchId]);
    }

    async fetchStuckTx(batchId, relayerAddr) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const res = await client.query(`
                UPDATE batch_transactions
                SET status = 'SENDING_RPC', relayer_address = $1, updated_at = NOW()
                WHERE id = (
                    SELECT id FROM batch_transactions
                    WHERE batch_id = $2 
                      AND (status = 'SENDING_RPC' OR status = 'FAILED')
                      AND updated_at < NOW() - INTERVAL '2 MINUTES'
                    ORDER BY id ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING *
            `, [relayerAddr, batchId]);
            await client.query('COMMIT');
            if (res.rows.length > 0) console.log(`🧹 Rescuing stuck Tx ${res.rows[0].id}`);
            return res.rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            return null;
        } finally {
            client.release();
        }
    }
}

module.exports = RelayerEngine;
