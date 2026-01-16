require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkBatches() {
    try {
        const res = await pool.query('SELECT id, batch_number, detail, error_message FROM batches ORDER BY id DESC LIMIT 5');
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkBatches();
