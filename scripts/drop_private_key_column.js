
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function dropColumn() {
    console.log(`🔒 HARDENING: Dropping 'private_key' column from 'faucets' table...`);

    try {
        await pool.query('ALTER TABLE faucets DROP COLUMN IF EXISTS private_key');
        console.log(`✅ Column dropped. Database can no longer store private keys.`);
    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await pool.end();
    }
}

dropColumn();
