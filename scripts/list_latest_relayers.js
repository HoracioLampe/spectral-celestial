
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function find() {
    const res = await pool.query('SELECT id, address, batch_id, private_key FROM relayers ORDER BY id DESC LIMIT 20');
    console.log(`Latest 20 Relayers in DB:`);
    res.rows.forEach(r => {
        console.log(`${r.id} | ${r.address} | Batch: ${r.batch_id} | PK: ${r.private_key ? r.private_key.substring(0, 10) + '...' : 'NULL'}`);
    });
    process.exit(0);
}

find();
