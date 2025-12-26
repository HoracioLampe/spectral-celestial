const ethers = require('ethers');

// Relayer Engine for High Throughput Processing
class RelayerEngine {
    constructor(pool, providerUrl, faucetPrivateKey) {
        this.pool = pool; // Postgres Pool
        this.provider = new ethers.JsonRpcProvider(providerUrl);
        this.faucetWallet = new ethers.Wallet(faucetPrivateKey, this.provider);

        // Configuration
        this.contractAddress = "0x1B9005DBb8f5EB197EaB6E2CB6555796e94663Af";
        this.contractABI = [
            "function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external",
            "function processedLeaves(bytes32) view returns (bool)",
            "function distributeMatic(address[] calldata recipients, uint256 amount) external payable"
        ];
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
        console.log(`🚀 Setting up Batch ${batchId} with ${numRelayers} relayers...`);

        // A. Create Ephemeral Wallets
        const relayers = [];
        for (let i = 0; i < numRelayers; i++) {
            relayers.push(ethers.Wallet.createRandom(this.provider));
        }

        // B. Record Relayers in DB for Audit (DO THIS FIRST so UI sees them)
        await this.persistRelayers(batchId, relayers);

        // Background the rest (Funding + Workers)
        this.backgroundProcess(batchId, relayers).catch(err => {
            console.error(`❌ Critical error in background execution for Batch ${batchId}:`, err);
        });

        console.log(`📡 Relayers persisted. Background thread handling funding and workers.`);
        return { success: true, count: relayers.length };
    }

    async backgroundProcess(batchId, relayers) {
        console.log(`[Background] Starting process for batch ${batchId}`);
        // C. Fund Relayers with Gas (Distribute equally)
        await this.distributeGasToRelayers(batchId, relayers);

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

    // 4. Process Logic (Sign & Send)
    async processTransaction(wallet, txDB, isRetry) {
        try {
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, wallet);

            // NOTE: PROOF GENERATION IS STUBBED. 
            const proof = [];

            const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [txDB.batch_id]);
            const funder = batchRes.rows[0].funder_address;
            const amountVal = ethers.parseUnits(txDB.amount_usdc.toString(), 6);

            // Estimate Gas
            const gasLimit = await contract.executeTransaction.estimateGas(
                txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof
            );

            // Execute
            const txResponse = await contract.executeTransaction(
                txDB.batch_id, txDB.id, funder, txDB.wallet_address_to, amountVal, proof,
                { gasLimit: gasLimit * 110n / 100n }
            );

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
        const txRes = await this.pool.query('SELECT id, amount_usdc, wallet_address_to FROM batch_transactions WHERE batch_id = $1', [batchId]);
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
            const proof = []; // Proof generation is currently a stub
            try {
                return await contract.executeTransaction.estimateGas(
                    batchId, tx.id, funder, tx.wallet_address_to, amountVal, proof
                );
            } catch (e) {
                console.warn(`[Estimate] Sample estimation failed for tx ${tx.id}, using fallback 200k`);
                return 200000n;
            }
        }));

        const totalSampleGas = sampleEstimates.reduce((acc, val) => acc + val, 0n);
        const averageGas = totalSampleGas / BigInt(sampleSize);
        const extrapolatedTotalGas = averageGas * BigInt(totalCount);

        // Add 50% buffer for safety
        const bufferedGas = extrapolatedTotalGas * 150n / 100n;

        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n; // fallback to 35 gwei
        const totalCostWei = bufferedGas * gasPrice;

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[Estimate] COMPLETED in ${duration}s. Total extrapolated gas: ${extrapolatedTotalGas}. Buffered: ${bufferedGas}.`);

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

        const count = relayers.length;
        const totalWei = amountWei * BigInt(count);
        console.log(`[Fund] Funding ${count} relayers with ${ethers.formatEther(amountWei)} MATIC each (SINGLE TX BATCH)`);

        try {
            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.faucetWallet);
            const addresses = relayers.map(r => r.address);

            // Execute single transaction for all fundings
            const tx = await contract.distributeMatic(addresses, amountWei, {
                value: totalWei,
                gasLimit: 100000n * BigInt(count) // Safe limit for batch
            });

            console.log(`[Fund] Batch Tx SENT: ${tx.hash}. Waiting for confirmation...`);
            await tx.wait();
            console.log(`[Fund] Batch Tx CONFIRMED! All ${count} relayers funded.`);

            // Proactive sync for all
            await Promise.all(relayers.map(r => this.syncRelayerBalance(r.address)));

        } catch (err) {
            console.error(`❌ Batch funding failed, falling back to sequential:`, err.message);

            // Fallback to manual sequential if contract call fails (e.g. not redeployed yet)
            let nonce = await this.faucetWallet.getNonce();
            for (const r of relayers) {
                try {
                    const tx = await this.faucetWallet.sendTransaction({
                        to: r.address,
                        value: amountWei,
                        nonce: nonce++,
                        gasLimit: 21000n
                    });
                    console.log(`   - Fallback sent to ${r.address.substring(0, 8)}`);
                    // We don't await tx.wait() here to avoid stalling, 
                    // we'll rely on the proactive sync later or background tracking
                    this.trackFallbackTx(tx, r.address);
                } catch (ser) {
                    console.error(`   - Fallback failed for ${r.address}:`, ser.message);
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

    // 7. Refund Logic
    async returnFundsToFaucet(relayers, batchId) {
        console.log("Refunding...");
        // In real implementation: sweep funds back
        await this.pool.query(`UPDATE relayers SET status = 'drained' WHERE batch_id = $1`, [batchId]);
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
