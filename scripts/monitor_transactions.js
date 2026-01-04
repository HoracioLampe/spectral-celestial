require('dotenv').config();
const { Pool } = require('pg');
const ethers = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function monitorAndRecoverStuckTransactions() {
    console.log("\n🔍 [Monitor] Checking for stuck transactions...");

    try {
        // 1. Find transactions stuck in WAITING_CONFIRMATION with no tx_hash (never sent)
        const stuckRes = await pool.query(`
            SELECT id, batch_id, wallet_address_to, status, updated_at, tx_hash
            FROM batch_transactions
            WHERE status = 'WAITING_CONFIRMATION'
            AND tx_hash IS NULL
            AND updated_at < NOW() - INTERVAL '1 minute'
            LIMIT 100
        `);

        if (stuckRes.rows.length > 0) {
            console.log(`⚠️  [Monitor] Found ${stuckRes.rows.length} transactions stuck in WAITING_CONFIRMATION with no tx_hash`);
            console.log(`   Resetting to PENDING for retry...`);

            // Reset them to PENDING so the relayer system can retry
            const result = await pool.query(`
                UPDATE batch_transactions
                SET status = 'PENDING', retry_count = COALESCE(retry_count, 0) + 1
                WHERE status = 'WAITING_CONFIRMATION'
                AND tx_hash IS NULL
                AND updated_at < NOW() - INTERVAL '1 minute'
                RETURNING id
            `);

            console.log(`✅ [Monitor] Reset ${result.rowCount} transactions to PENDING`);
        }

        // 2. Find transactions in WAITING_CONFIRMATION with tx_hash (sent but not confirmed)
        const waitingRes = await pool.query(`
            SELECT id, batch_id, wallet_address_to, tx_hash, updated_at
            FROM batch_transactions
            WHERE status = 'WAITING_CONFIRMATION'
            AND tx_hash IS NOT NULL
            AND updated_at < NOW() - INTERVAL '2 minutes'
            LIMIT 50
        `);

        if (waitingRes.rows.length > 0) {
            console.log(`🔎 [Monitor] Found ${waitingRes.rows.length} transactions waiting for confirmation > 2 min`);
            console.log(`   Checking blockchain status...`);

            let recovered = 0;
            let dropped = 0;

            for (const tx of waitingRes.rows) {
                try {
                    const receipt = await provider.getTransactionReceipt(tx.tx_hash);

                    if (receipt) {
                        // Transaction was mined!
                        const newStatus = receipt.status === 1 ? 'COMPLETED' : 'FAILED';
                        await pool.query(
                            `UPDATE batch_transactions SET status = $1 WHERE id = $2`,
                            [newStatus, tx.id]
                        );
                        console.log(`   ✅ TX ${tx.id}: ${newStatus} (block ${receipt.blockNumber})`);
                        recovered++;
                    } else {
                        // Check if still in mempool
                        const pendingTx = await provider.getTransaction(tx.tx_hash);
                        if (!pendingTx) {
                            // Transaction was dropped - reset to PENDING
                            await pool.query(
                                `UPDATE batch_transactions SET status = 'PENDING', tx_hash = NULL, retry_count = COALESCE(retry_count, 0) + 1 WHERE id = $1`,
                                [tx.id]
                            );
                            console.log(`   ⚠️  TX ${tx.id}: Dropped from mempool, reset to PENDING`);
                            dropped++;
                        }
                    }
                } catch (err) {
                    console.error(`   ❌ TX ${tx.id}: RPC error - ${err.message}`);
                }
            }

            if (recovered > 0 || dropped > 0) {
                console.log(`📊 [Monitor] Recovered: ${recovered}, Dropped: ${dropped}`);
            }
        }

        // 3. Find stale ENVIANDO transactions (stuck in "sending" state)
        const staleRes = await pool.query(`
            SELECT id, batch_id, wallet_address_to, status, updated_at
            FROM batch_transactions
            WHERE status = 'ENVIANDO'
            AND updated_at < NOW() - INTERVAL '30 seconds'
            LIMIT 100
        `);

        if (staleRes.rows.length > 0) {
            console.log(`⚠️  [Monitor] Found ${staleRes.rows.length} stale ENVIANDO transactions`);
            const result = await pool.query(`
                UPDATE batch_transactions
                SET status = 'PENDING', retry_count = COALESCE(retry_count, 0) + 1
                WHERE status = 'ENVIANDO'
                AND updated_at < NOW() - INTERVAL '30 seconds'
                RETURNING id
            `);
            console.log(`✅ [Monitor] Reset ${result.rowCount} stale transactions to PENDING`);
        }

        // 4. Summary
        const summary = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM batch_transactions
            WHERE status IN ('PENDING', 'WAITING_CONFIRMATION', 'ENVIANDO', 'FAILED')
            GROUP BY status
        `);

        if (summary.rows.length > 0) {
            console.log(`\n📊 [Monitor] Current Status:`);
            summary.rows.forEach(row => {
                console.log(`   ${row.status}: ${row.count}`);
            });
        } else {
            console.log(`✅ [Monitor] All transactions completed!`);
        }

    } catch (error) {
        console.error("❌ [Monitor] Error:", error.message);
    }
}

// Run continuously
async function startMonitor() {
    console.log("🚀 Starting Transaction Monitor...");
    console.log("   Checking every 60 seconds for stuck transactions\n");

    while (true) {
        await monitorAndRecoverStuckTransactions();
        await new Promise(r => setTimeout(r, 60000)); // Wait 1 minute
    }
}

startMonitor().catch(err => {
    console.error("💥 Monitor crashed:", err);
    process.exit(1);
});
