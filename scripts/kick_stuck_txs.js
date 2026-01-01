const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function kickStuck() {
    try {
        console.log("🦵 Kicking stuck transactions...");

        // 1. Get the relevant batch (latest active one)
        const batchRes = await pool.query(`
            SELECT id FROM batches 
            WHERE status IN ('EXECUTING', 'PAUSED') 
            ORDER BY id DESC LIMIT 1
        `);

        if (batchRes.rows.length === 0) {
            console.log("No active batch found.");
            return;
        }

        const batchId = batchRes.rows[0].id;
        console.log(`Targeting Batch ID: ${batchId}`);

        // 2. Reset 'ENVIANDO' or stuck 'PENDING' transactions
        // We really just want to notify the user or restart the loop, but updating updated_at 
        // might help if sorting logic depends on it, or just checking if they are eligible.

        // A more aggressive kick: Reset 'FAILED' ones to 'PENDING' to retry them if they are under max retries 
        // (though engine should handle this).
        // Let's reset any 'ENVIANDO' that are old (> 5 mins) to 'PENDING' so they get picked up again.

        const resetRes = await pool.query(`
            UPDATE batch_transactions 
            SET status = 'PENDING', relayer_address = NULL, tx_hash = NULL, updated_at = NOW()
            WHERE batch_id = $1 
              AND status IN ('ENVIANDO', 'WAITING_CONFIRMATION') 
              AND updated_at < NOW() - INTERVAL '5 minutes'
            RETURNING id
        `, [batchId]);

        console.log(`🔄 Reset ${resetRes.rowCount} stuck 'ENVIANDO'/'WAITING' transactions to 'PENDING'.`);

        // 3. Count remaining
        const remaining = await pool.query(`
            SELECT count(*) FROM batch_transactions 
            WHERE batch_id = $1 AND status != 'COMPLETED'
        `, [batchId]);

        console.log(`📊 ${remaining.rows[0].count} transactions remaining to process.`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

kickStuck();
