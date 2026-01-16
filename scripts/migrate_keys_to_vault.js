require('dotenv').config();
const { Pool } = require('pg');
const vault = require('../services/vault');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrateKeys() {
    console.log(`🔒 Vault Migration: Moving keys from DB to Vault...`);

    if (!vault.enabled) {
        console.error("❌ Vault Service NOT enabled. Check VAULT_ADDR and VAULT_TOKEN.");
        process.exit(1);
    }

    try {
        // 1. Get all faucets with plaintext keys (ignore placeholders)
        const resFaucets = await pool.query("SELECT * FROM faucets WHERE private_key IS NOT NULL AND private_key NOT IN ('VAULT_SECURED', 'VAULT_ERROR')");
        console.log(`Found ${resFaucets.rows.length} faucet keys to migrate.`);

        for (const row of resFaucets.rows) {
            const address = row.address;
            const pk = row.private_key;

            if (!address || !pk) continue;

            console.log(`Processing Faucet: ${address}...`);
            const saved = await vault.saveFaucetKey(address, pk);

            if (saved) {
                await pool.query("UPDATE faucets SET private_key = 'VAULT_SECURED' WHERE id = $1", [row.id]);
                console.log(`   ✅ Faucet Secured.`);
            }
        }

        // 2. Get all relayers with plaintext keys
        const resRelayers = await pool.query("SELECT * FROM relayers WHERE private_key IS NOT NULL AND private_key NOT IN ('VAULT_SECURED', 'VAULT_ERROR')");
        console.log(`Found ${resRelayers.rows.length} relayer keys to migrate.`);

        for (const row of resRelayers.rows) {
            const address = row.address;
            const pk = row.private_key;

            if (!address || !pk) continue;

            console.log(`Processing Relayer: ${address}...`);
            const saved = await vault.saveRelayerKey(address, pk);

            if (saved) {
                await pool.query("UPDATE relayers SET private_key = 'VAULT_SECURED' WHERE id = $1", [row.id]);
                console.log(`   ✅ Relayer Secured.`);
            }
        }

        console.log("🏁 Migration Complete.");

    } catch (err) {
        console.error("❌ Fatal Error:", err.message);
    } finally {
        await pool.end();
    }
}

migrateKeys();
