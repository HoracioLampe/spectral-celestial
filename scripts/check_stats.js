
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkStats() {
    try {
        const bRes = await pool.query('SELECT id, batch_number, status FROM batches ORDER BY id DESC LIMIT 50');

        console.log(`\n📋 RETRY STATISTICS REPORT (Last 50 Batches)`);
        console.log(`--------------------------------------------------------------------------------`);
        console.log(`| BATCH ID | STATUS      | TOTAL | COMPL | MAX RETRIES | AVG RETRIES |`);
        console.log(`--------------------------------------------------------------------------------`);

        for (const batch of bRes.rows) {
            const res = await pool.query(`
                SELECT 
                    COUNT(*) as total_txs,
                    COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
                    MAX(retry_count) as max_retries,
                    AVG(retry_count) as avg_retries
                FROM batch_transactions 
                WHERE batch_id = $1
            `, [batch.id]);

            const s = res.rows[0];
            if (s.total_txs === '0' || s.total_txs === 0) continue;

            const max = s.max_retries || 0;
            const avg = parseFloat(s.avg_retries || 0).toFixed(2);

            console.log(`| ${batch.id.toString().padEnd(8)} | ${batch.status.padEnd(11)} | ${s.total_txs.toString().padEnd(5)} | ${s.completed.toString().padEnd(5)} | ${max.toString().padEnd(11)} | ${avg.padEnd(11)} |`);
        }
        console.log(`--------------------------------------------------------------------------------`);

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        await pool.end();
    }
}

checkStats();
