const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const client = await pool.connect();
    const res = await client.query('SELECT COUNT(*) FROM batch_transactions WHERE batch_id = 12');
    console.table(res.rows);
    client.release();
    pool.end();
}

check();
