
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const res = await pool.query('SELECT address, status, last_balance FROM relayers WHERE batch_id = 338');
    console.log(`Relayers for Batch 338: ${res.rows.length}`);
    res.rows.forEach(r => console.log(`${r.address} | ${r.status} | ${r.last_balance}`));
    process.exit(0);
}

check();
