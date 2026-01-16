const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check247() {
    try {
        const res = await pool.query(`SELECT id, status FROM batches WHERE id = 247`);
        console.log("Batch 247 Status:");
        console.log(JSON.stringify(res.rows[0]));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check247();
