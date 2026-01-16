
require('dotenv').config();
const { Pool } = require('pg');
const vault = require('../services/vault');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("🔍 Verifying Vault Accessibility for Faucets and Relayers...");

    if (!vault.enabled) {
        console.error("❌ Vault not enabled. Stopping.");
        process.exit(1);
    }

    const results = [];

    try {
        // 1. Verify Faucets
        console.log("--- Checking Faucets ---");
        const faucetRes = await pool.query('SELECT address FROM faucets');
        for (const row of faucetRes.rows) {
            const pk = await vault.getFaucetKey(row.address);
            results.push({
                Type: 'Faucet',
                Address: row.address,
                Status: pk ? '✅ READABLE' : '❌ NOT FOUND',
                PK_Prefix: pk ? pk.substring(0, 10) + '...' : 'N/A'
            });
        }

        // 2. Verify Sample of Relayers
        console.log("--- Checking Sample of Relayers (Last 5) ---");
        const relRes = await pool.query("SELECT address, batch_id FROM relayers WHERE private_key = 'VAULT_SECURED' ORDER BY id DESC LIMIT 5");
        for (const row of relRes.rows) {
            const pk = await vault.getRelayerKey(row.address);
            results.push({
                Type: `Relayer (B:${row.batch_id})`,
                Address: row.address,
                Status: pk ? '✅ READABLE' : '❌ NOT FOUND',
                PK_Prefix: pk ? pk.substring(0, 10) + '...' : 'N/A'
            });
        }

        console.log("--- Verification Results (JSON) ---");
        console.log(JSON.stringify(results, null, 2));

        if (results.every(r => r.Status.includes('✅'))) {
            console.log("\n✅ ALL KEYS VERIFIED READABLE FROM VAULT.");
        } else {
            console.warn("\n⚠️ SOME KEYS COULD NOT BE READ.");
        }
        console.error("❌ Error during verification:", err);
    } finally {
        await pool.end();
    }
}

run();
