const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        const lastBatchRes = await pool.query('SELECT id, batch_number FROM batches ORDER BY id DESC LIMIT 1');
        if (lastBatchRes.rows.length === 0) {
            console.log('No batches found');
            return;
        }
        const batchId = lastBatchRes.rows[0].id;
        console.log(`Checking Batch: ${lastBatchRes.rows[0].batch_number} (ID: ${batchId})`);

        const failedRes = await pool.query("SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = 'FAILED'", [batchId]);
        const pendingRes = await pool.query("SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = 'PENDING'", [batchId]);
        const sentRes = await pool.query("SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = 'SENT'", [batchId]);
        const completedRes = await pool.query("SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND status = 'COMPLETED'", [batchId]); // Assuming COMPLETED or CONFIRMED? Usually it's CONFIRMED or executed, checking logic. Let's assume SENT is in flight.
        const retriesRes = await pool.query("SELECT count(*) FROM batch_transactions WHERE batch_id = $1 AND retry_count > 0", [batchId]);
        const totalRes = await pool.query("SELECT count(*) FROM batch_transactions WHERE batch_id = $1", [batchId]);

        console.log(`Total Txs: ${totalRes.rows[0].count}`);
        console.log(`Pending: ${pendingRes.rows[0].count}`);
        console.log(`Sent (In Flight): ${sentRes.rows[0].count}`);
        console.log(`Failed: ${failedRes.rows[0].count}`);
        console.log(`Retried: ${retriesRes.rows[0].count}`);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
