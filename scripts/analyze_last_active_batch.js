
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function analyzeLastBatch() {
    try {
        // Find the latest batch that has COMPLETED transactions
        const activeBatchRes = await pool.query(`
            SELECT batch_id 
            FROM batch_transactions 
            WHERE status = 'COMPLETED' 
            ORDER BY batch_id DESC 
            LIMIT 1
        `);

        if (activeBatchRes.rows.length === 0) {
            console.log("❌ No batches with completed transactions found.");
            return;
        }

        const batchId = activeBatchRes.rows[0].batch_id;
        console.log(`\n🔍 ANALYZING LAST ACTIVE BATCH: ${batchId}`);
        console.log("================================================================================");

        const statsRes = await pool.query(`
            SELECT 
                COUNT(*) as total_txs,
                COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
                COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
                COUNT(*) FILTER (WHERE status = 'COMPLETED' AND (retry_count = 0 OR retry_count IS NULL)) as direct_success,
                MAX(retry_count) as max_retries
            FROM batch_transactions 
            WHERE batch_id = $1
        `, [batchId]);

        const s = statsRes.rows[0];

        console.log(`📊 Batch #${batchId} Results:`);
        console.log(`   - Total Transacciones:   ${s.total_txs}`);
        console.log(`   - Pasaron Directas:      ${s.direct_success} (Sin reintentos)`);
        console.log(`   - Máximos Reintentos:    ${s.max_retries || 0}`);
        console.log(`   - Total Fallidas:        ${s.failed}`);
        console.log(`   - Total Completadas:     ${s.completed}`);
        console.log("================================================================================\n");

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        await pool.end();
    }
}

analyzeLastBatch();
