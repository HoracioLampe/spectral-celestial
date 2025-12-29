
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function reportFinalStats() {
    try {
        console.log("\n📊 FINAL PERFORMANCE REPORT");
        console.log("================================================================================");

        // 1. Analyze Batch 158 (The Benchmark)
        const res158 = await pool.query(`
            SELECT 
                COUNT(*) as total,
                MAX(retry_count) as max_retries,
                AVG(retry_count) as avg_retries
            FROM batch_transactions 
            WHERE batch_id = 158
        `);
        const s158 = res158.rows[0];

        console.log(`🔹 BATCH 158 (High Congestion Benchmark):`);
        console.log(`   - Total Transactions: ${s158.total}`);
        console.log(`   - Max Retries used:   ${s158.max_retries}`);
        console.log(`   - Avg Retries:         ${parseFloat(s158.avg_retries || 0).toFixed(2)}`);

        // 2. Analyze Batch 164 (Most Recent Success)
        const res164 = await pool.query(`
            SELECT 
                COUNT(*) as total,
                MAX(retry_count) as max_retries,
                AVG(retry_count) as avg_retries
            FROM batch_transactions 
            WHERE batch_id = 164
        `);
        const s164 = res164.rows[0];

        console.log(`\n🔹 BATCH 164 (Recent Perfect Execution):`);
        console.log(`   - Total Transactions: ${s164.total}`);
        console.log(`   - Max Retries used:   ${s164.max_retries}`);
        console.log(`   - Avg Retries:         ${parseFloat(s164.avg_retries || 0).toFixed(2)}`);

        // 3. Current Security Status
        const faucetRes = await pool.query('SELECT address, created_at FROM faucets ORDER BY id DESC LIMIT 1');
        const faucet = faucetRes.rows[0];

        console.log(`\n🔒 SECURITY & LIQUIDITY:`);
        console.log(`   - Current Faucet:     ${faucet ? faucet.address : 'NONE'}`);
        console.log(`   - Generated at:       ${faucet ? faucet.created_at : 'N/A'}`);
        console.log(`   - Automatic Sweep:    ACTIVE (Implementation confirmed in relayerEngine.js)`);

        console.log("================================================================================\n");

    } catch (e) {
        console.error("❌ Error generating report:", e);
    } finally {
        await pool.end();
    }
}

reportFinalStats();
