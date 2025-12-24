const ethers = require('ethers');

// Relayer Engine for High Throughput Processing
class RelayerEngine {
    constructor(pool, providerUrl, faucetPrivateKey) {
        this.pool = pool; // Postgres Pool
        this.provider = new ethers.providers.JsonRpcProvider(providerUrl);
        this.faucetWallet = new ethers.Wallet(faucetPrivateKey, this.provider);
    }

    // 1. Orchestrator: Start the Batch
    async startBatchProcessing(batchId, numRelayers) {
        console.log(`🚀 Starting Batch ${batchId} with ${numRelayers} relayers...`);

        // A. Create Ephemeral Wallets
        const relayers = [];
        for (let i = 0; i < numRelayers; i++) {
            relayers.push(ethers.Wallet.createRandom().connect(this.provider));
        }

        // B. Fund Relayers (Distribute Gas)
        await this.fundRelayers(relayers);

        // C. Record Relayers in DB for Audit
        await this.persistRelayers(batchId, relayers);

        // D. Launch Workers (Parallel Execution)
        const workerPromises = relayers.map(wallet => this.workerLoop(wallet, batchId));

        // E. Wait for completion
        await Promise.all(workerPromises);

        // F. Refund & Cleanup
        await this.returnFundsToFaucet(relayers, batchId);

        console.log(`✅ Batch ${batchId} Processing Complete.`);
        return { success: true };
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
            // Mock Transaction for Prototype (Replace with real transfer/contract call)
            // In real scenario: contract.executeTransaction(...)

            // Simulation: Simple Transfer to confirm checks
            // const tx = await wallet.sendTransaction({
            //     to: txDB.wallet_address_to,
            //     value: ethers.utils.parseEther("0.0001") // Tiny amount for test
            // });

            // For now, let's just simulate delay to test concurrency
            // await new Promise(r => setTimeout(r, 1000)); 

            // Real Mock Hash since we are not sending real funds yet in this phase
            const mockHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(new Date().toISOString() + wallet.address));

            // Mark as SENT in DB
            await this.pool.query(
                `UPDATE batch_transactions SET status = 'SENT', tx_hash = $1, updated_at = NOW() WHERE id = $2`,
                [mockHash, txDB.id]
            );

        } catch (e) {
            console.error(`Tx Failed: ${txDB.id}`, e);
            await this.pool.query(
                `UPDATE batch_transactions SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
                [txDB.id]
            );
        }
    }

    // 5. Funding Logic
    async fundRelayers(relayers) {
        console.log(`Funding ${relayers.length} relayers...`);
        // In real implementation: Send MATIC from faucetWallet to each relayer.address
    }

    // 6. Persistence
    async persistRelayers(batchId, relayers) {
        for (const r of relayers) {
            await this.pool.query(
                `INSERT INTO relayers (batch_id, address, private_key, status) VALUES ($1, $2, $3, 'active')`,
                [batchId, r.address, r.privateKey] // WARN: Encrypt in Prod
            );
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
