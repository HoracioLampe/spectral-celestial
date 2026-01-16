
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function find() {
    const res = await pool.query('SELECT id, address, private_key FROM faucets ORDER BY id DESC LIMIT 5');
    console.log(`Latest 5 Faucets in DB:`);
    res.rows.forEach(r => {
        console.log(`${r.id} | ${r.address} | PK: ${r.private_key ? r.private_key.substring(0, 10) + '...' : 'VAULT_SECURED'}`);
    });
    process.exit(0);
}

find();
