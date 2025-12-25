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
            "function processedLeaves(bytes32) view returns (bool)"
        ];
    }

    // 1. Orchestrator: Start the Batch
    async startBatchProcessing(batchId, numRelayers) {
        console.log(`🚀 Starting Batch ${batchId} with ${numRelayers} relayers...`);

        // A. Create Ephemeral Wallets
        const relayers = [];
        for (let i = 0; i < numRelayers; i++) {
            relayers.push(ethers.Wallet.createRandom(this.provider));
        }

        // B. Fund Relayers (Distribute Gas)
        await this.fundRelayers(relayers);

        // C. Record Relayers in DB for Audit
        await this.persistRelayers(batchId, relayers);
        // Distribute gas with 50% buffer equally among relayers
        await this.distributeGasToRelayers(batchId, relayers);

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

            console.log(`Tx SENT: ${txResponse.hash}`);

            await this.pool.query(
                `UPDATE batch_transactions SET status = 'SENT', tx_hash = $1, updated_at = NOW() WHERE id = $2`,
                [txResponse.hash, txDB.id]
            );

            // Update Relayer Last Activity
            await this.pool.query(
                `UPDATE relayers SET last_activity = NOW() WHERE address = $1`,
                [wallet.address]
            );
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

    // 8. Estimate total gas for a batch (including 50% buffer) and return total cost in wei
    async estimateBatchGas(batchId) {
        // Fetch all pending transactions for the batch
        const txRes = await this.pool.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [batchId]);
        const txs = txRes.rows;
        if (txs.length === 0) return { totalGas: 0n, totalCostWei: 0n };
        const batchRes = await this.pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funder = batchRes.rows[0]?.funder_address || ethers.ZeroAddress;
        const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);
        let totalGas = 0n;
        for (const tx of txs) {
            const amountVal = ethers.parseUnits(tx.amount_usdc.toString(), 6);
            const proof = [];
            try {
                const gas = await contract.executeTransaction.estimateGas(
                    batchId,
                    tx.id,
                    funder,
                    tx.wallet_address_to,
                    amountVal,
                    proof
                );
                totalGas = totalGas + gas;
            } catch (e) {
                console.error(`Gas estimation failed for tx ${tx.id}:`, e);
            }
        }
        // Add 50% buffer
        const bufferedGas = totalGas * 150n / 100n;
        const feeData = await this.provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n; // fallback to 35 gwei
        const totalCostWei = bufferedGas * gasPrice;
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

    // Updated funding logic to accept amount per relayer
    async fundRelayers(relayers, amountWei) {
        if (!amountWei) {
            console.log(`Funding ${relayers.length} relayers (legacy call)...`);
            return;
        }
        console.log(`Funding ${relayers.length} relayers with ${ethers.formatEther(amountWei)} MATIC each`);
        const txs = [];
        for (const r of relayers) {
            const tx = this.faucetWallet.sendTransaction({ to: r.address, value: amountWei });
            txs.push(tx);
        }
        await Promise.all(txs.map(p => p.then(r => r.wait())));

        // Update Relayers Last Activity
        for (const r of relayers) {
            await this.pool.query(`UPDATE relayers SET last_activity = NOW() WHERE address = $1`, [r.address]);
        }

        console.log('✅ Funding complete');
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
