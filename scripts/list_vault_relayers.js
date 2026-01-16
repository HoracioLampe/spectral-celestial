
require('dotenv').config();
const { Pool } = require('pg');
const vault = require('../services/vault');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("📑 Listing ALL Relayers and their Private Keys from Vault...");

    if (!vault.enabled) {
        console.error("❌ Vault not enabled. Check VAULT_TOKEN in .env");
        process.exit(1);
    }

    try {
        // Fetch all relayers from DB to know which addresses to check in Vault
        const relRes = await pool.query("SELECT address, batch_id, private_key as db_status FROM relayers ORDER BY batch_id DESC, id DESC");
        console.log(`🔍 Found ${relRes.rows.length} relayers in DB. Checking Vault...`);

        const tableData = [];
        let successCount = 0;
        let failCount = 0;

        for (const row of relRes.rows) {
            const pk = await vault.getRelayerKey(row.address);
            if (pk) {
                successCount++;
                tableData.push({
                    Batch: row.batch_id,
                    Address: row.address,
                    Vault_PK: pk.substring(0, 10) + "...",
                    DB_Status: row.db_status,
                    Accessible: "✅"
                });
            } else {
                failCount++;
                tableData.push({
                    Batch: row.batch_id,
                    Address: row.address,
                    Vault_PK: "NOT FOUND",
                    DB_Status: row.db_status,
                    Accessible: "❌"
                });
            }
        }

        console.table(tableData);
        console.log(`\n📊 Summary:`);
        console.log(` - Total Relayers: ${relRes.rows.length}`);
        console.log(` - Readable from Vault: ${successCount}`);
        console.log(` - Missing from Vault: ${failCount}`);

        if (failCount > 0) {
            console.warn("\n⚠️ WARNING: Some relayers marked as VAULT_SECURED in DB are NOT accessible in Vault.");
        }

    } catch (err) {
        console.error("❌ Fatal Error:", err);
    } finally {
        await pool.end();
    }
}

run();
