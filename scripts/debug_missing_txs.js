
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkTxs() {
    try {
        // Get latest batch
        const batchRes = await pool.query('SELECT * FROM batches ORDER BY id DESC LIMIT 1');
        if (batchRes.rows.length === 0) {
            console.log("No batches found.");
            return;
        }
        const batch = batchRes.rows[0];
        console.log(`Latest Batch ID: ${batch.id}`);
        console.log(`Batch Number: ${batch.batch_number}`);
        console.log(`Total Txs (Metadata): ${batch.total_transactions}`);

        // Count actual txs
        const countRes = await pool.query('SELECT COUNT(*) FROM batch_transactions WHERE batch_id = $1', [batch.id]);
        console.log(`Actual Txs in DB: ${countRes.rows[0].count}`);

        // Fetch sample
        const sampleRes = await pool.query('SELECT * FROM batch_transactions WHERE batch_id = $1 LIMIT 5', [batch.id]);
        console.log("Sample Txs:", sampleRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkTxs();
