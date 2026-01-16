const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkFailed() {
    try {
        console.log("Connecting to DB...");
        // Get the latest batch
        const batchRes = await pool.query('SELECT * FROM batches ORDER BY created_at DESC LIMIT 1');
        const batch = batchRes.rows[0];
        console.log(`Latest Batch ID: ${batch.id} | Status: ${batch.status}`);

        // Count failed
        const failedRes = await pool.query('SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = \'FAILED\'', [batch.id]);
        console.log(`Failed Count: ${failedRes.rows[0].count}`);

        // Count Waiting
        const waitingRes = await pool.query('SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = \'WAITING_CONFIRMATION\'', [batch.id]);
        console.log(`Waiting Confirmation Count: ${waitingRes.rows[0].count}`);

        // Count pending
        const pendingRes = await pool.query('SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = \'PENDING\'', [batch.id]);
        console.log(`Pending Count: ${pendingRes.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkFailed();
