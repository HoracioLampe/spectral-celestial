
const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkLatest() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM batches ORDER BY id DESC LIMIT 1');
        if (res.rows.length === 0) {
            console.log("No batches found.");
            return;
        }
        const batch = res.rows[0];
        console.log(`Latest Batch ID: ${batch.id}`);
        console.log(`Description: ${batch.description}`);
        console.log(`Total Txs (Metadata): ${batch.total_transactions}`);

        const statusRes = await client.query(`
            SELECT status, COUNT(*) as count 
            FROM batch_transactions 
            WHERE batch_id = $1 
            GROUP BY status
        `, [batch.id]);

        console.table(statusRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        pool.end();
    }
}

checkLatest();
