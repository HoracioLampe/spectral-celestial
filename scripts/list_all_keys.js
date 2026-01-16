
require('dotenv').config();
const { Pool } = require('pg');
const vault = require('../services/vault');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("🔍 Comprehensive Vault Key Audit...");

    if (!vault.enabled) {
        console.error("❌ Vault not enabled in .env.");
        process.exit(1);
    }

    const tableData = [];

    try {
        // 1. Faucets
        console.log("Checking Faucets...");
        const faucetRes = await pool.query("SELECT address FROM faucets");
        for (const row of faucetRes.rows) {
            const pk = await vault.getFaucetKey(row.address);
            tableData.push({
                Type: 'Faucet',
                Address: row.address,
                'Private Key': pk ? (pk.substring(0, 10) + '...') : '❌ NOT FOUND'
            });
        }

        // 2. Relayers
        console.log("Checking Relayers...");
        const relRes = await pool.query("SELECT address FROM relayers ORDER BY id DESC");
        for (const row of relRes.rows) {
            const pk = await vault.getRelayerKey(row.address);
            tableData.push({
                Type: 'Relayer',
                Address: row.address,
                'Private Key': pk ? (pk.substring(0, 10) + '...') : '❌ NOT FOUND'
            });
        }

        console.table(tableData);

    } catch (err) {
        console.error("❌ Fatal Audit Failure:", err.message);
    } finally {
        await pool.end();
    }
}

run();
