
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugBatch161() {
    try {
        console.log("🔍 Checking Database for Batch 161...");

        // 1. Check Batch Details
        const batchRes = await pool.query('SELECT * FROM batches WHERE id = 161');
        if (batchRes.rows.length === 0) {
            console.log("❌ Batch 161 NOT FOUND in DB.");
            return;
        }
        console.log("✅ Batch 161 Found:", batchRes.rows[0]);

        // 2. Check Relayers
        const relayerRes = await pool.query('SELECT count(*) FROM relayers WHERE batch_id = 161');
        const count = parseInt(relayerRes.rows[0].count);
        console.log(`🔢 Relayers for Batch 161: ${count}`);

        if (count === 0) {
            console.log("⚠️ No relayers found! Setup phase likely failed or wasn't triggered.");
        } else {
            console.log("✅ Relayers exist. Maybe funding failed?");
            const fundedRes = await pool.query('SELECT count(*) FROM relayers WHERE batch_id = 161 AND last_balance IS NOT NULL AND last_balance != \'0\'');
            console.log(`💰 Funded Relayers: ${fundedRes.rows[0].count}`);
        }

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        await pool.end();
    }
}

debugBatch161();
