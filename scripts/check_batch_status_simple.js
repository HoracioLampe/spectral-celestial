const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkBatchStatus() {
    try {
        const res = await pool.query(`SELECT id, status, created_at FROM batches ORDER BY id DESC LIMIT 5`);
        console.log("Batches found:");
        res.rows.forEach(r => console.log(JSON.stringify(r)));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkBatchStatus();
