
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkBatches() {
    try {
        console.log("🔍 Buscando lotes recientes...");
        const res = await pool.query(`
            SELECT id, batch_number, status, total_transactions, 
            (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = batches.id AND status = 'COMPLETED') as completed,
            (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = batches.id AND status = 'PENDING') as pending,
            (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = batches.id AND status = 'FAILED') as failed,
            created_at
            FROM batches 
            ORDER BY id DESC 
            LIMIT 5
        `);

        console.table(res.rows.map(r => ({
            ID: r.id,
            Number: r.batch_number,
            Status: r.status,
            Total: r.total_transactions,
            Done: r.completed,
            Pending: r.pending,
            Failed: r.failed
        })));
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

checkBatches();
