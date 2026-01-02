const ethers = require('ethers');

// Relayer Engine for High Throughput Processing
class RelayerEngine {
    constructor(pool, rpcManager, faucetPrivateKey) {
        this.pool = pool; // Postgres Pool
        this.rpcManager = rpcManager;
        // Legacy support: if rpcManager is string, wrap it (handled in server.js ideally, but safe check here)
        this.provider = rpcManager.provider || new ethers.JsonRpcProvider(rpcManager);

        // Faucet setup needs a provider, we bind to the dynamic one from manager
        // But Wallet needs a fixed provider instance. We'll access rpcManager.getProvider() dynamically where possible,
        // or recreate wallet on switch. For now, let's keep it simple:
        // Use the current provider. If RpcManager switches, we might need to update this.faucetWallet.provider.
        // Better approach: Use execute() wrapper for all calls.

        this.faucetPrivateKey = faucetPrivateKey;
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
            "function batchRoots(address funder, uint256 batchId) view returns (bytes32)",
            "event TransactionExecuted(uint256 indexed batchId, uint256 indexed txId, address indexed recipient, address funder, uint256 amount)"
        ];
    }

    // Helper to get current valid provider
    getProvider() {
        return this.rpcManager.getProvider ? this.rpcManager.getProvider() : this.provider;
    }

    // --- Configuration Constants ---
    static GAS_BUFFER_PERCENTAGE = 60n; // Default 60% buffer
    static GAS_CUSHION_MATIC = ethers.parseEther("0.25"); // Default 0.25 MATIC cushion
    static MAX_RETRIES = 1000; // Indefinite retry limit

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

        // Step 0: Ensure Faucet is healthy (Nonce Repair)
        // This prevents collisions if a previous batch is still finishing up or if Faucet state is stuck.
        await this.verifyAndRepairNonce();

        // Check for existing relayers in DB
        const existingRelayersRes = await this.pool.query(
            'SELECT address, private_key FROM relayers WHERE batch_id = $1',
            [batchId]
        );

        let relayers = [];
        if (existingRelayersRes.rows.length > 0) {
            console.log(`[Engine] Found ${existingRelayersRes.rows.length} existing relayers for Batch ${batchId}.`);
            relayers = existingRelayersRes.rows.map(r => new ethers.Wallet(r.private_key, this.provider));
        }

        // Expand if requested count > existing count
        if (relayers.length < numRelayers) {
            const needed = numRelayers - relayers.length;
            console.log(`[Engine] Expanding relayers from ${relayers.length} to ${numRelayers} (+${needed} new)...`);

            const newRelayers = [];
            for (let i = 0; i < needed; i++) {
                const wallet = ethers.Wallet.createRandom();
                const connectedWallet = wallet.connect(this.provider);
                newRelayers.push(connectedWallet);
                relayers.push(connectedWallet);
            }
            // Persist ONLY the new ones
            await this.persistRelayers(batchId, newRelayers);
        } else if (relayers.length > numRelayers) {
            console.log(`[Engine] Note: Using ${relayers.length} existing relayers (Requested: ${numRelayers}). Excess relayers are kept active.`);
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
        // Track Start Time
        const startTime = Date.now();
        console.log(`[Background] 🎬 START | Batch: ${batchId} | Relayers: ${relayers.length} | StartTime: ${new Date(startTime).toISOString()}`);

        // Update Status to SENT (Enviando) immediately
        await this.pool.query(`UPDATE batches SET status = 'SENT', start_time = NOW(), updated_at = NOW() WHERE id = $1`, [batchId]);

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

                        // TRACK GAS COST (Root)
                        const gasUsed = BigInt(receipt.gasUsed);
                        const gasPrice = BigInt(receipt.effectiveGasPrice || 0);
                        const rootFee = gasUsed * gasPrice;

                        const rootFeeMatic = ethers.formatEther(rootFee);
                        await this.pool.query(
                            `UPDATE batches SET funding_amount = COALESCE(funding_amount, 0) + $1 WHERE id = $2`,
                            [rootFeeMatic, batchId]
                        );
                        console.log(`[Engine][Gas] ⛽ Added Root Gas Cost: ${rootFeeMatic} MATIC to Funding.`);
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

                    // TRACK GAS COST (Permit)
                    const gasUsed = BigInt(receipt.gasUsed);
                    const gasPrice = BigInt(receipt.effectiveGasPrice || 0);
                    const permitFee = gasUsed * gasPrice;

                    const permitFeeMatic = ethers.formatEther(permitFee);
                    await this.pool.query(
                        `UPDATE batches SET funding_amount = COALESCE(funding_amount, 0) + $1 WHERE id = $2`,
                        [permitFeeMatic, batchId]
                    );
                    console.log(`[Engine][Gas] ⛽ Added Permit Gas Cost: ${permitFeeMatic} MATIC to Funding.`);
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

        try {
            await Promise.all(workerPromises);
        } catch (err) {
            console.error(`[Engine] ⚠️ Worker Swarm Error: ${err.message}`);
        }

        // 5. Retry Phase (Auto-Repair dropped txs) - ALWAYS RUN
        try {
            console.log(`[Engine] 🔄 Entering Retry Phase...`);
            await this.retryFailedTransactions(batchId, relayers);
        } catch (err) {
            console.error(`[Engine] ⚠️ Retry Phase Error: ${err.message}`);
        }

        // G. Refund & Cleanup (ALWAYS RUN)
        try {
            // CHECK: Only refund if ALL transactions are COMPLETED.
            const pendingCountRes = await this.pool.query(
                `SELECT COUNT(*) FROM batch_transactions WHERE batch_id = $1 AND status IN ('PENDING', 'FAILED', 'ENVIANDO', 'WAITING_CONFIRMATION')`,
                [batchId]
            );
            const pendingCount = parseInt(pendingCountRes.rows[0].count);

            if (pendingCount > 0) {
                console.warn(`[Engine] ⚠️ Skipping Fund Recovery: ${pendingCount} transactions are still PENDING/FAILED.`);
            } else {
                console.log(`[Engine] 🧹 All clear. Cleaning up & Returning Funds...`);
                try {
                    await this.returnFundsToFaucet(relayers, batchId);
                } catch (cleanupErr) {
                    console.error(`[Engine] ⚠️ Refund failed (ignoring to save metrics): ${cleanupErr.message}`);
                }
            }

            // --- CALCULATE FINAL METRICS ---
            const endTime = Date.now();
            const durationMs = endTime - startTime;

            // Format duration (e.g., "2m 15s")
            const minutes = Math.floor(durationMs / 60000);
            const seconds = ((durationMs % 60000) / 1000).toFixed(0);
            const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

            // Aggregate Total Gas from Database (Net Calculation)
            const metricsRes = await this.pool.query(
                `SELECT funding_amount, refund_amount FROM batches WHERE id = $1`,
                [batchId]
            );
            const funding = metricsRes.rows[0]?.funding_amount || 0;
            const refunded = metricsRes.rows[0]?.refund_amount || 0;

            // Calculate Net Cost: Funding - Refunded (Includes Distribution Cost if we added it to Funding, or just Value)
            // If funding is 0 (legacy), fallback to sum(gas_cost)
            let totalGasMatic = "0";

            if (funding > 0) {
                const netCost = parseFloat(funding) - parseFloat(refunded);
                totalGasMatic = Math.max(0, netCost).toFixed(6);
                console.log(`[Engine] 🧮 Net Gas Calc: ${funding} (Funded) - ${refunded} (Refunded) = ${totalGasMatic}`);
            } else {
                // Fallback to old summation method
                const gasRes = await this.pool.query(
                    `SELECT SUM(gas_cost::numeric) as total_gas FROM relayers WHERE batch_id = $1`,
                    [batchId]
                );
                totalGasMatic = gasRes.rows[0].total_gas || "0";
            }

            console.log(`[Engine] 🏁 Metrics | Time: ${durationStr} | Gas: ${totalGasMatic} MATIC`);

            // Update Batch with Metrics and Final Status
            await this.pool.query(
                `UPDATE batches SET 
                    status = 'COMPLETED', 
                    total_gas_used = $1, 
                    execution_time = $2, 
                    end_time = NOW(),
                    updated_at = NOW() 
                 WHERE id = $3`,
                [totalGasMatic, durationStr, batchId]
            );

            console.log(`✅ Batch ${batchId} Processing Complete. metrics saved.`);
        } catch (finalErr) {
            console.error(`[Engine] ⚠️ Final Cleanup/Metrics Error: ${finalErr.message}`);
        }
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
            // Throttle worker to avoid smashing RPC (RPS Limit Protection)
            await new Promise(r => setTimeout(r, 1000));
        }

        // Save total gas spent by this worker
        // Save total gas spent by this worker
        console.log(`👷 Worker ${wallet.address.substring(0, 6)} Saving Gas: ${ethers.formatEther(totalGasWei)} MATIC`);
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

            // Fetch Funder FIRST (Needed for Idempotency Check)
            const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [txDB.batch_id]);
            const funder = batchRes.rows[0].funder_address;

            // IDEMPOTENCY CHECK: Check if leaf is already processed on-chain
            // Calculate Leaf Hash: keccak256(abi.encode(chainId, contract, batchId, txId, funder, recipient, amount))
            const abiCoder = ethers.AbiCoder.defaultAbiCoder();
            const leafHash = ethers.keccak256(abiCoder.encode(
                ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                [chainId, this.contractAddress, BigInt(txDB.batch_id), BigInt(txDB.id), funder, txDB.wallet_address_to, amountVal]
            ));

            const isProcessed = await contract.processedLeaves(leafHash);
            if (isProcessed) {
                console.log(`[Engine] 🟢 Tx ${txDB.id} already processed on-chain. Recovering data...`);

                // Try to find the real hash and amount in events
                const recovery = await this._recoverFromEvents(txDB.batch_id, txDB.id);
                const finalHash = recovery ? recovery.txHash : 'ON_CHAIN_DEDUPE';
                const finalAmount = recovery ? recovery.amount : txDB.amount_usdc.toString();

                await this.pool.query(
                    `UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = $1, amount_transferred = $2, updated_at = NOW() WHERE id = $3`,
                    [finalHash, finalAmount, txDB.id]
                );
                return { success: true, txHash: finalHash, gasUsed: 0n, effectiveGasPrice: 0n };
            }

            console.log(`[Engine] Executing Standard for Batch ${txDB.batch_id} (TX #${txDB.id})`);

            // PRE-FLIGHT CHECK: Verify Allowance & Balance to avoid generic CALL_EXCEPTION
            try {
                const usdc = new ethers.Contract(this.usdcAddress, [
                    "function allowance(address,address) view returns (uint256)",
                    "function balanceOf(address) view returns (uint256)"
                ], this.provider);

                const [allowance, balance] = await Promise.all([
                    usdc.allowance(funder, this.contractAddress),
                    usdc.balanceOf(funder)
                ]);

                if (balance < amountVal) {
                    throw new Error(`Insufficient USDC Balance. Funder has ${ethers.formatUnits(balance, 6)}, needs ${ethers.formatUnits(amountVal, 6)}`);
                }
                if (allowance < amountVal) {
                    throw new Error(`Insufficient USDC Allowance. Funder approved ${ethers.formatUnits(allowance, 6)}, needs ${ethers.formatUnits(amountVal, 6)}`);
                }
            } catch (preFlightErr) {
                console.warn(`[Engine] ⚠️ Pre-Flight Check Failed: ${preFlightErr.message}`);
                // If it's our custom error, rethrow it to abort
                if (preFlightErr.message.includes("Insufficient")) throw preFlightErr;
            }

            const gasLimit = await contract.executeTransaction.estimateGas(
                txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof
            );
            const feeData = await this.provider.getFeeData();
            const gasPrice = (feeData.gasPrice * 120n) / 100n; // 20% boost

            const txResponse = await contract.executeTransaction(
                txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof,
                {
                    gasLimit: gasLimit * 140n / 100n, // 40% gas limit buffer
                    gasPrice: gasPrice
                }
            );

            console.log(`[Blockchain][Tx] SENT: ${txResponse.hash} | TxID: ${txDB.id} | From: ${wallet.address}`);

            // Increase timeout to 5 minutes for high congestion
            const receipt = await Promise.race([
                txResponse.wait(1), // Wait for 1 confirmation
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for receipt (300s)")), 300000))
            ]);

            if (receipt.status === 1) {
                console.log(`[Blockchain][Tx] CONFIRMED: ${txResponse.hash} | Batch: ${txDB.batch_id} | TxID: ${txDB.id}`);
                await this.pool.query(
                    `UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = $1, amount_transferred = $2, updated_at = NOW() WHERE id = $3`,
                    [txResponse.hash, txDB.amount_usdc.toString(), txDB.id]
                );
            } else {
                console.warn(`[Blockchain][Tx] FAILED ON-CHAIN: ${txResponse.hash}`);
                const nextStatus = (txDB.retry_count >= 100) ? 'FAILED' : 'WAITING_CONFIRMATION';
                await this.pool.query(`UPDATE batch_transactions SET status = $1, tx_hash = $2, updated_at = NOW() WHERE id = $3`, [nextStatus, txResponse.hash, txDB.id]);
            }

            await this.syncRelayerBalance(wallet.address);

            // Return receipt data so worker can track gas (Even if failed)
            return {
                success: receipt.status === 1,
                txHash: txResponse.hash,
                gasUsed: receipt ? receipt.gasUsed : 0n,
                effectiveGasPrice: receipt ? receipt.effectiveGasPrice : 0n
            };

        } catch (e) {
            if (e.message && e.message.includes("Tx already executed")) {
                console.log(`⚠️ Tx ${txDB.id} already on-chain. Recovered.`);
                await this.pool.query(`UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = 'RECOVERED', updated_at = NOW() WHERE id = $1`, [txDB.id]);
                return { success: true, txHash: 'RECOVERED', gasUsed: 0n, effectiveGasPrice: 0n };
            }
            console.error(`Tx Failed: ${txDB.id}`, e.message);
            // If it failed BEFORE receipt (e.g. estimation error, timeout), we have 0 gas
            const nextStatus = (txDB.retry_count >= 100) ? 'FAILED' : 'WAITING_CONFIRMATION';
            await this.pool.query(`UPDATE batch_transactions SET status = $1, updated_at = NOW() WHERE id = $2`, [nextStatus, txDB.id]);
            return { success: false, error: e.message, gasUsed: 0n, effectiveGasPrice: 0n };
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
                if (e.message && e.message.includes("Merkle")) {
                    console.log(`[Engine]   > Sample Tx ${tx.id}: Using safe fallback (Root not set).`);
                } else {
                    console.warn(`[Engine]   > Sample Tx ${tx.id} estimation failed, using fallback 150k. Error: ${e.message}`);
                }
                totalSampleGas += 150000n;
            }
        }

        const averageGas = totalSampleGas / BigInt(sampleSize);
        // Use Configurable Buffer
        const bufferPercent = RelayerEngine.GAS_BUFFER_PERCENTAGE || 30n; // Reduced from 60n
        const bufferedGas = (averageGas * BigInt(txs.length)) * (100n + bufferPercent) / 100n;
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n;

        // Use Configurable Cushion
        const safetyCushion = RelayerEngine.GAS_CUSHION_MATIC || ethers.parseEther("0.1"); // Reduced from 0.25
        const totalCost = (bufferedGas * gasPrice) + safetyCushion;

        console.log(`[Engine]   > Total estimated cost: ${ethers.formatEther(totalCost)} MATIC (inc. 0.05 buffer)`);
        return { totalCostWei: totalCost };
    }

    async distributeGasToRelayers(batchId, relayers) {
        const { totalCostWei } = await this.estimateBatchGas(batchId);
        if (relayers.length === 0 || totalCostWei === 0n) return;

        // Step 0: Ensure Network Health
        // await this.verifyAndRepairNonce(); // Faucet-specific nonce repair needed now, handled per wallet

        // 1. Determine Correct Faucet (Funder-Specific)
        let funderFaucetWallet = this.faucetWallet; // Default fallback
        let funderFaucetAddress = this.faucetWallet.address;

        try {
            const faucetRes = await this.pool.query(`
                SELECT f.address, f.private_key
                FROM batches b
                JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
                WHERE b.id = $1
            `, [batchId]);

            if (faucetRes.rows.length > 0) {
                const { address, private_key } = faucetRes.rows[0];
                funderFaucetWallet = new ethers.Wallet(private_key, this.provider);
                funderFaucetAddress = address;
                console.log(`[Engine][Fund] 🎯 Using Funder-Specific Faucet: ${address}`);
            } else {
                console.warn(`[Engine][Fund] ⚠️ No specific faucet for batch ${batchId}. Using Global Faucet.`);
            }
        } catch (err) {
            console.error("Faucet lookup error during funding", err);
        }

        // Check Faucet Balance BEFORE calculating per-relayer split
        const faucetBalance = await this.provider.getBalance(funderFaucetAddress);

        // --- DYNAMIC RESERVE CALCULATION ---
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("50", "gwei"); // Fallback higher for safety

        // Calculate Gas accurately for the Distribution Transaction itself
        // Formula matches fundRelayers: 200k base + 50k per relayer
        const distributeGasLimit = 200000n + (BigInt(relayers.length) * 50000n);
        const distributeTxCost = distributeGasLimit * gasPrice;

        // Safety Margin for Distribution Tx (1.5x of estimated cost) + Floor of 0.5 MATIC
        const dynamicReserve = (distributeTxCost * 150n) / 100n;
        const minReserve = ethers.parseEther("0.5");
        const reserveGas = dynamicReserve > minReserve ? dynamicReserve : minReserve;

        console.log(`[Engine][Fund] ⛽ Est. Gas Cost for Distribution: ${ethers.formatEther(distributeTxCost)} MATIC. Using Reserve: ${ethers.formatEther(reserveGas)} MATIC`);

        // CONSERVATIVE BUFFER: User requested 2x (200%) default safety. Configurable via env.
        const bufferPercent = BigInt(process.env.RELAYER_GAS_BUFFER_PERCENT || "200");
        let fundAmount = (totalCostWei * bufferPercent) / 100n;
        let warningMsg = null;

        // Check if we have enough for: FUNDING + DISTRIBUTION GAS
        if (faucetBalance < (fundAmount + reserveGas)) {
            // Critical Check: Do we even have enough for the GAS of the distribution tx?
            if (faucetBalance < reserveGas) {
                throw new Error(`CRÍTICO: Faucet vacío o insuficiente para GAS de distribución. Balance: ${ethers.formatEther(faucetBalance)} MATIC. Mínimo Gas: ${ethers.formatEther(reserveGas)}`);
            }

            console.warn(`[Engine][Fund] ⚠️ Faucet low! Needed: ${ethers.formatEther(fundAmount)} + ${ethers.formatEther(reserveGas)} Gas | Has: ${ethers.formatEther(faucetBalance)}`);

            // Cap funding to available balance minus reserve
            fundAmount = faucetBalance - reserveGas;

            // Check if the capped amount is dangerously low (e.g. < totalCostWei raw)
            // If we can't even cover the RAW cost (without buffer), we should probably stops or strictly warn.
            if (fundAmount < totalCostWei) {
                const missing = ethers.formatEther((totalCostWei + reserveGas) - faucetBalance);
                throw new Error(`FONDOS INSUFICIENTES: Faltan ${missing} MATIC en la Faucet para cubrir los costos de gas de los relayers y la transacción. Balance: ${ethers.formatEther(faucetBalance)}`);
            }

            if (fundAmount <= 0n) {
                // Formatting error message strictly for UI parsing
                throw new Error(`Faucet sin fondos suficientes. Balance: ${ethers.formatEther(faucetBalance)} MATIC.`);
            }
            warningMsg = `⚠️ Fondos ajustados. Se redujo el buffer. Disp: ${ethers.formatEther(fundAmount)} MATIC`;
            console.log(warningMsg);
        }

        const perRelayerWei = fundAmount / BigInt(relayers.length);
        console.log(`🪙 [Background] Funding: ${ethers.formatEther(fundAmount)} MATIC total (${ethers.formatEther(perRelayerWei)} per relayer)`);

        try {
            // Pass the specific wallet to use
            await this.fundRelayers(batchId, relayers, perRelayerWei, funderFaucetWallet);
        } catch (err) {
            // Enhance error for UI (Catch re-thrown errors)
            if (err.message.includes("insufficient funds") || err.code === 'INSUFFICIENT_FUNDS') {
                throw new Error(`Faucet sin fondos suficientes. Balance: ${ethers.formatEther(faucetBalance)} MATIC. Requerido: ${ethers.formatEther(totalCostWei)}`);
            }
            throw err;
        }
    }

    async fundRelayers(batchId, relayers, amountWei, actingFaucetWallet) {
        if (!amountWei || amountWei === 0n) return;
        const walletToUse = actingFaucetWallet || this.faucetWallet;

        try {
            // Re-instantiate contract with specific signer
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, walletToUse);
            const totalValueToSend = amountWei * BigInt(relayers.length);

            // Double check balance (Race condition safety)
            const faucetBalance = await this.provider.getBalance(walletToUse.address);
            console.log(`[Engine][Fund] Faucet Balance (${walletToUse.address.substring(0, 6)}..): ${ethers.formatEther(faucetBalance)} MATIC`);

            // Add slight tolerance check
            if (faucetBalance < totalValueToSend) {
                throw new Error(`Insufficient Faucet balance. Need ${ethers.formatEther(totalValueToSend)} MATIC, have ${ethers.formatEther(faucetBalance)}.`);
            }

            console.log(`[Engine][Fund] 🚀 Atomic Distribution START: ${relayers.length} relayers.`);
            console.log(`[Engine][Fund] Target: ${ethers.formatEther(amountWei)} MATIC each | Total: ${ethers.formatEther(totalValueToSend)} MATIC`);

            // Gas Calculation: Increased Baseline (200k) + 50k per recipient for safety
            const safeGasLimit = 200000n + (BigInt(relayers.length) * 50000n);

            const tx = await contract.distributeMatic(
                relayers.map(r => r.address),
                amountWei, // Sending strictly calculated amount
                {
                    value: totalValueToSend,
                    gasLimit: safeGasLimit
                }
            );

            console.log(`[Blockchain][Fund] Atomic Batch SENT: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`[Blockchain][Fund] Atomic Batch CONFIRMED (Block: ${receipt.blockNumber})`);

            // Optimistic DB Update: Set balance immediately so UI is responsive
            // We know exactly how much we sent: amountWei
            const amountMaticStr = ethers.formatEther(amountWei);
            await Promise.all(relayers.map(r =>
                this.pool.query(
                    `UPDATE relayers SET last_balance = $1, transactionhash_deposit = $2, last_activity = NOW(), status = 'active' WHERE address = $3 AND batch_id = $4`,
                    [amountMaticStr, tx.hash, r.address, batchId]
                )
            ));
            console.log(`[Engine][Fund] ⚡ Optimistic Balance Update: All relayers set to ${amountMaticStr} MATIC (and Reactivated)`);

            // Batched Verification (Optional / Background)
            // We can still run sync, but maybe lazily or skipping if we trust the receipt.
            // Let's keep it but it won't block the UI showing the value we just injected.
            /*
            const chunkSize = 5;
            for (let i = 0; i < relayers.length; i += chunkSize) {
                const chunk = relayers.slice(i, i + chunkSize);
                await Promise.all(chunk.map(r => this.syncRelayerBalance(r.address)));
                if (i + chunkSize < relayers.length) await new Promise(r => setTimeout(r, 200));
            }
            */

            // Save Funding Total to Batch (Value Sent + Approx Fee)
            // Fee is approx execution gas * gasPrice. Let's precise using receipt.gasUsed
            const gasUsed = BigInt(receipt.gasUsed);
            const gasPrice = BigInt(receipt.effectiveGasPrice || 0); // Handle potential undefined/null
            const distributionFeeFn = gasUsed * gasPrice;

            // totalValueToSend is already BigInt (calculated above)
            const totalFundingMatic = ethers.formatEther(totalValueToSend + distributionFeeFn);

            await this.pool.query(
                `UPDATE batches SET funding_amount = $1 WHERE id = $2`,
                [totalFundingMatic, batchId]
            );
            console.log(`[Engine][Fund] 💾 Saved Funding Amount: ${totalFundingMatic} MATIC (incl. fee)`);

        } catch (err) {
            console.error(`❌ Atomic funding FAILED:`, err.message);
            // FAIL FAST: Do not fallback to sequential distribution which causes nonce chaos.
            throw new Error(`Atomic Funding Failed: ${err.message}`);
        }
    }

    /**
     * AUTO-REPAIR: Checks for stuck "ghost" transactions in mempool and clears them.
     * Aggressively loops until Pending == Latest.
     */
    async verifyAndRepairNonce() {
        try {
            const address = this.faucetWallet.address;
            let latestNonce = await this.provider.getTransactionCount(address, "latest");
            let pendingNonce = await this.provider.getTransactionCount(address, "pending");

            console.log(`[AutoRepair] 🔍 Nonce Check: L=${latestNonce} | P=${pendingNonce}`);

            let attempt = 0;
            const MAX_ATTEMPTS = 10; // Safety break

            while (pendingNonce > latestNonce && attempt < MAX_ATTEMPTS) {
                attempt++;
                console.warn(`[AutoRepair] ⚠️ Stuck Queue Detected (Diff: ${pendingNonce - latestNonce}). Clearing slot ${latestNonce}...`);

                const feeData = await this.provider.getFeeData();
                const boostPrice = (feeData.gasPrice * 30n) / 10n; // 3x aggressive gas

                // Send 0-value self-transfer to overwrite the "head" of the stuck queue
                try {
                    const tx = await this.faucetWallet.sendTransaction({
                        to: address,
                        value: 0,
                        nonce: latestNonce,
                        gasLimit: 30000,
                        gasPrice: boostPrice
                    });
                    console.log(`[AutoRepair] 💉 Correction TX Sent: ${tx.hash}. Waiting...`);
                    await tx.wait();
                    console.log(`[AutoRepair] ✅ Slot ${latestNonce} cleared.`);
                } catch (txErr) {
                    console.warn(`[AutoRepair] ⚠️ Tx Replacement failed: ${txErr.message}. Retrying check...`);
                }

                // Refresh counts
                latestNonce = await this.provider.getTransactionCount(address, "latest");
                pendingNonce = await this.provider.getTransactionCount(address, "pending");
            }

            if (pendingNonce > latestNonce) {
                console.warn(`[AutoRepair] ⚠️ Queue still stuck after ${MAX_ATTEMPTS} attempts. Proceeding with caution.`);
            } else {
                console.log(`[AutoRepair] ✨ Mempool is clean.`);
            }

        } catch (e) {
            console.warn(`[AutoRepair] ⚠️ Failed to auto-repair nonce: ${e.message}`);
        }
    }

    /**
     * RETRY LOGIC: 
     * Loops up to 10 times to catch dropped/failed transactions.
     * Uses idempotency check to avoid double-spending.
     */
    // --- Configuration Constants ---
    static GAS_BUFFER_PERCENTAGE = 60n; // Default 60% buffer
    static GAS_CUSHION_MATIC = ethers.parseEther("0.25"); // Default 0.25 MATIC cushion

    /**
     * RETRY LOGIC: 
     * Loops up to 1000 times (effectively indefinite) to catch dropped/failed transactions.
     * Uses idempotency check to avoid double-spending.
     */
    async retryFailedTransactions(batchId, relayers) {
        const MAX_RETRIES = RelayerEngine.MAX_RETRIES || 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            // Find FAILED/PENDING/WAITING transactions
            const failedRes = await this.pool.query(
                `SELECT * FROM batch_transactions WHERE batch_id = $1 AND status IN ('FAILED', 'PENDING', 'WAITING_CONFIRMATION') AND retry_count < $2`,
                [batchId, 100]
            );

            if (failedRes.rows.length === 0) {
                console.log(`[Engine] ✨ All transactions completed successfully.`);
                break;
            }

            console.log(`[Engine] 🔄 Retry Cycle ${attempt}/${MAX_RETRIES}: Found ${failedRes.rows.length} failed/pending txs.`);

            // Shuffle relayers to ensure "another relayer grabs it" (avoiding sticky bad relayers)
            const shuffledRelayers = [...relayers].sort(() => Math.random() - 0.5);

            // Distribute reprocessing among relayers with THROTTLING
            const CONCURRENCY = 50; // Increased from 5 to 50 for max speed (1 batch = 50 tx)
            for (let i = 0; i < failedRes.rows.length; i += CONCURRENCY) {
                const chunk = failedRes.rows.slice(i, i + CONCURRENCY);
                const tasks = chunk.map((tx, idx) => {
                    // Use shuffled array
                    const relayer = shuffledRelayers[(i + idx) % shuffledRelayers.length];
                    return (async () => {
                        await this.pool.query(`UPDATE batch_transactions SET retry_count = retry_count + 1 WHERE id = $1`, [tx.id]);
                        const res = await this.processTransaction(relayer, tx, true);

                        // TRACK GAS for retries
                        if (res.gasUsed && res.effectiveGasPrice) {
                            const cost = res.gasUsed * res.effectiveGasPrice;
                            const costMatic = ethers.formatEther(cost);
                            await this.pool.query(
                                `UPDATE relayers SET gas_cost = COALESCE(gas_cost::numeric, 0) + $1 WHERE address = $2 AND batch_id = $3`,
                                [costMatic, relayer.address, batchId]
                            );
                        }
                    })();
                });
                await Promise.all(tasks);
                // Subtle delay between chunks
                await new Promise(r => setTimeout(r, 200));
            }

            // Wait before next retry cycle (Backoff)
            if (attempt < MAX_RETRIES) {
                const waitTime = Math.min(attempt * 2000, 10000); // Max 10s delay
                console.log(`[Engine] ⏳ Waiting ${waitTime / 1000}s before next retry...`);
                await new Promise(r => setTimeout(r, waitTime));
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
        console.log(`[Refund] 🧹 Starting fund recovery for Batch ${batchId}...`);

        // 1. Determine Correct Faucet (Funder-Specific)
        let targetFaucetAddress = null;
        try {
            const faucetRes = await this.pool.query(`
                SELECT f.address 
                FROM batches b
                JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
                WHERE b.id = $1
            `, [batchId]);

            if (faucetRes.rows.length > 0) {
                targetFaucetAddress = faucetRes.rows[0].address;
                console.log(`[Refund] 🎯 Found Funder-Specific Faucet: ${targetFaucetAddress}`);
            } else {
                console.warn(`[Refund] ⚠️ No specific faucet for batch ${batchId}. Fallback to latest.`);
                const fallbackRes = await this.pool.query('SELECT address FROM faucets ORDER BY id DESC LIMIT 1');
                if (fallbackRes.rows.length > 0) targetFaucetAddress = fallbackRes.rows[0].address;
            }
        } catch (err) {
            console.error("Faucet lookup error", err);
        }

        if (!targetFaucetAddress) {
            console.error("[Refund] ❌ No faucet found DB. Aborting sweep.");
            return 0;
        }
        console.log(`[Refund] 🏦 Sweep Target: ${targetFaucetAddress}`);

        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n; // Default 50 gwei
        const boostedGasPrice = (gasPrice * 130n) / 100n; // 30% Boost for speed
        const costWei = 21000n * boostedGasPrice;

        // Safety buffer: 0.05 MATIC (Aggressive)
        const safetyBuffer = ethers.parseEther("0.05");

        console.log(`[Refund] ⛽ Gas Price: ${ethers.formatUnits(boostedGasPrice, 'gwei')} gwei | Min Cost: ${ethers.formatEther(costWei)}`);

        // Note: 'relayers' argument might be partial if process restarted. Fetch from DB for authority.
        const activeRelayersRes = await this.pool.query('SELECT address, private_key FROM relayers WHERE batch_id = $1', [batchId]);
        const activeRelayers = activeRelayersRes.rows.map(r => new ethers.Wallet(r.private_key, this.provider));

        console.log(`[Refund] Checking balances for ${activeRelayers.length} relayers...`);

        // Concurrency limit for large batches
        const concurrency = 20;
        let totalRecovered = 0;
        let recoveredWei = 0n;

        const worker = async (wallet, idx) => {
            try {
                // Staggered start to prevent rate limits
                await new Promise(res => setTimeout(res, idx * 100));

                const bal = await this.provider.getBalance(wallet.address);

                if (bal > (costWei + safetyBuffer)) {
                    // Send strictly calculated amount: Balance - (Cost + Buffer)
                    // We knowingly leave 'Buffer' amount behind to guarantee success.
                    let amount = bal - costWei - safetyBuffer;

                    if (amount > 0n) {
                        console.log(`[Refund] 💸 Sweeping ${ethers.formatEther(amount)} MATIC from ${wallet.address.substring(0, 6)}...`);
                        try {
                            const tx = await wallet.sendTransaction({
                                to: targetFaucetAddress,
                                value: amount,
                                gasLimit: 21000n,
                                gasPrice: boostedGasPrice
                            });
                            console.log(`[Refund] ✅ Tx Sent: ${tx.hash}`);
                            await tx.wait(); // Wait for confirmation

                            recoveredWei += amount;

                            // Mark drained effectively
                            await this.pool.query(
                                `UPDATE relayers SET last_balance = '0', drain_balance = $1, transactionhash_deposit = $2, status = 'drained', last_activity = NOW() WHERE address = $3 AND batch_id = $4`,
                                [ethers.formatEther(bal), tx.hash, wallet.address, batchId]
                            );

                        } catch (txErr) {
                            console.warn(`[Refund] ❌ Tx Failed for ${wallet.address.substring(0, 6)}:`, txErr.message);
                        }
                    }
                } else {
                    // Mark as drained even if we didn't extract funds (it's dust)
                    await this.pool.query(
                        `UPDATE relayers SET last_balance = $1, drain_balance = $1, status = 'drained', last_activity = NOW() WHERE address = $2 AND batch_id = $3`,
                        [ethers.formatEther(bal), wallet.address, batchId]
                    );
                }
            } catch (err) {
                console.warn(`[Refund] ⚠️ Failed for ${wallet.address.substring(0, 6)}:`, err.message);
            }
        };

        // Execute in chunks
        for (let i = 0; i < activeRelayers.length; i += concurrency) {
            const chunk = activeRelayers.slice(i, i + concurrency);
            await Promise.all(chunk.map((w, idx) => worker(w, i + idx)));
        }

        totalRecovered = Number(ethers.formatEther(recoveredWei));

        // Save Refund Total to Batch
        await this.pool.query(
            `UPDATE batches SET refund_amount = $1, status = 'COMPLETED', updated_at = NOW() WHERE id = $2`,
            [totalRecovered.toFixed(6), batchId]
        );

        console.log(`[Refund] ✅ Sweep complete for Batch ${batchId}. Total Recovered: ${totalRecovered.toFixed(6)} MATIC`);
        return totalRecovered;
    }

    /**
     * Internal helper to find a transaction in blockchain events.
     */
    async _recoverFromEvents(batchId, txId) {
        try {
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);
            const latestBlock = await this.provider.getBlockNumber();
            const startBlock = latestBlock - 10000; // Search last ~5-6 hours

            const filter = contract.filters.TransactionExecuted(batchId, txId);
            const logs = await contract.queryFilter(filter, startBlock, latestBlock);

            if (logs.length > 0) {
                const log = logs[0];
                return {
                    txHash: log.transactionHash,
                    amount: log.args.amount.toString()
                };
            }
        } catch (e) {
            console.warn(`[Engine] Recovery failed for Tx ${txId}: ${e.message}`);
        }
        return null;
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
