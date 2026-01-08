
require('dotenv').config();
const { Pool } = require('pg');
const vault = require('../services/vault');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("🛠️ Starting Filtered Relayer Cleanup & Migration...");

    if (!vault.enabled) {
        console.error("❌ Vault not enabled. Stopping.");
        process.exit(1);
    }

    try {
        // 1. Identify the last 10 batch IDs
        const batchRes = await pool.query('SELECT id FROM batches ORDER BY id DESC LIMIT 10');
        const keepIds = batchRes.rows.map(r => r.id);
        console.log(`Keep relayers for Batches: ${keepIds.join(', ')}`);

        // 2. Delete relayers NOT in these batches OR without deposit hash
        const deleteRes = await pool.query(`
            DELETE FROM relayers 
            WHERE 
                (batch_id NOT IN (${keepIds.join(',')}) OR batch_id IS NULL)
                OR 
                (transactionhash_deposit IS NULL OR transactionhash_deposit = '')
        `);
        console.log(`🗑️ Deleted ${deleteRes.rowCount} relayers (old, orphan or without deposit hash).`);

        // 3. Fetch remaining relayers with plaintext keys
        const relRes = await pool.query("SELECT * FROM relayers WHERE private_key IS NOT NULL AND private_key NOT IN ('VAULT_SECURED', 'VAULT_ERROR')");
        console.log(`📦 Found ${relRes.rows.length} relayers to migrate.`);

        // 4. Migrate to Vault
        for (let i = 0; i < relRes.rows.length; i++) {
            const r = relRes.rows[i];
            try {
                // Use the standardized storeRelayerKey method
                await vault.storeRelayerKey(r.address, r.private_key);

                // Update DB to placeholder
                await pool.query("UPDATE relayers SET private_key = 'VAULT_SECURED' WHERE id = $1", [r.id]);

                if ((i + 1) % 50 === 0 || (i + 1) === relRes.rows.length) {
                    console.log(`   ✅ Secured ${i + 1}/${relRes.rows.length} relayers.`);
                }
            } catch (err) {
                console.error(`   ❌ Failed for ${r.address}: ${err.message}`);
                await pool.query("UPDATE relayers SET private_key = 'VAULT_ERROR' WHERE id = $1", [r.id]);
            }
        }

        console.log("🏁 Filtered Migration Complete.");

    } catch (err) {
        console.error("❌ Fatal Error:", err);
    } finally {
        await pool.end();
    }
}

run();
