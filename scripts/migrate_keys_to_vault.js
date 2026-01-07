
const { Pool } = require('pg');
const vault = require('../services/vault');
require('dotenv').config();

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
        const res = await pool.query("SELECT * FROM faucets WHERE private_key IS NOT NULL AND private_key != 'VAULT_SECURED'");

        console.log(`Found ${res.rows.length} keys to migrate.`);

        for (const row of res.rows) {
            const funder = row.funder_address;
            const pk = row.private_key;

            if (!funder || !pk) {
                console.warn(`⚠️ Skipping row ${row.id}: Missing funder or pk`);
                continue;
            }

            console.log(`Processing Funder: ${funder}...`);

            // 2. Save to Vault (Using Funder Address as ID as requested)
            const saved = await vault.saveFaucetKey(funder, pk);

            if (saved) {
                // 3. Update DB to placeholder
                await pool.query("UPDATE faucets SET private_key = 'VAULT_SECURED' WHERE id = $1", [row.id]);
                console.log(`   ✅ Secured & DB Updated.`);
            } else {
                console.error(`   ❌ Failed to save to Vault. DB NOT updated.`);
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
