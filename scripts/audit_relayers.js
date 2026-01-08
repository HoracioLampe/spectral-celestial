
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("📊 Auditing Relayer Key Status...");
    try {
        const res = await pool.query("SELECT private_key, COUNT(*) FROM relayers GROUP BY private_key");
        console.log("\nSummary:");
        res.rows.forEach(r => console.log(` - ${r.private_key}: ${r.count}`));

        if (res.rows.some(r => r.private_key === 'VAULT_SECURED')) {
            console.log("\n⚠️ WARNING: Some relayers are marked as VAULT_SECURED.");
            console.log("Checking if we can read one...");
            const sample = await pool.query("SELECT address FROM relayers WHERE private_key = 'VAULT_SECURED' LIMIT 1");
            if (sample.rows.length > 0) {
                console.log(`Sample Address: ${sample.rows[0].address}`);
            }
        }
    } catch (err) {
        console.error("❌ Audit failed:", err);
    } finally {
        await pool.end();
    }
}
run();
