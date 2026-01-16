
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetFaucets() {
    console.log(`🚨 SECURITY RESET: Deleting ALL compromised Faucets...`);
    console.log(`⚠️ This will force ALL users to generate new wallets on next action.`);

    try {
        const res = await pool.query('DELETE FROM faucets');
        console.log(`\n💥 DELETED ${res.rowCount} rows from 'faucets' table.`);
        console.log(`✅ System Clean. New secure wallets will be created via Vault logic.`);
    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await pool.end();
    }
}

resetFaucets();
