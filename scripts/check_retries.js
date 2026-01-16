
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkRetries() {
    try {
        const batchId = process.argv[2];
        if (!batchId) {
            console.log("⚠️ Please provide a batch ID. Usage: node scripts/check_retries.js <batch_id>");
            // Check for latest batch as fallback
            const latestRes = await pool.query('SELECT MAX(id) as max_id FROM batches');
            if (latestRes.rows[0].max_id) {
                console.log(`🔎 Defaulting to latest batch: ${latestRes.rows[0].max_id}`);
                return checkRetriesForBatch(latestRes.rows[0].max_id);
            }
            return;
        }
        await checkRetriesForBatch(batchId);
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

async function checkRetriesForBatch(batchId) {
    console.log(`📊 Checking Retry Statistics for BATCH ${batchId}...`);

    // 1. Overview Breakdown
    const resStats = await pool.query(`
        SELECT status, retry_count, COUNT(*) as count 
        FROM batch_transactions 
        WHERE batch_id = $1
        GROUP BY status, retry_count 
        ORDER BY retry_count DESC, status
    `, [batchId]);

    console.table(resStats.rows);

    // 2. Total Retried vs Clean
    const resTotal = await pool.query(`
        SELECT 
            COUNT(*) FILTER (WHERE retry_count > 0) as total_retried,
            COUNT(*) FILTER (WHERE retry_count = 0) as clean_run,
            MAX(retry_count) as max_retries_needed,
            COUNT(*) as total_txs
        FROM batch_transactions
        WHERE batch_id = $1
    `, [batchId]);

    console.log("\n📈 Summary:");
    console.log(`   - Total Transactions:   ${resTotal.rows[0].total_txs}`);
    console.log(`   - Success on First Try: ${resTotal.rows[0].clean_run}`);
    console.log(`   - Retried Transactions: ${resTotal.rows[0].total_retried}`);
    console.log(`   - Max Retries Used:     ${resTotal.rows[0].max_retries_needed}`);
}

checkRetries();
