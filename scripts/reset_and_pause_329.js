require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function resetAndPauseBatch329() {
    try {
        const batchId = 329;

        console.log(`\n🔄 Reseteando Batch ${batchId} a PENDING...\n`);

        // Reset all WAITING_CONFIRMATION to PENDING
        const resetRes = await pool.query(`
            UPDATE batch_transactions
            SET status = 'PENDING'
            WHERE batch_id = $1
            AND status = 'WAITING_CONFIRMATION'
        `, [batchId]);

        console.log(`✅ ${resetRes.rowCount} transacciones reseteadas a PENDING`);

        // Pause batch to prevent auto-processing
        const pauseRes = await pool.query(`
            UPDATE batches
            SET status = 'READY'
            WHERE id = $1
        `, [batchId]);

        console.log(`✅ Batch ${batchId} pausado (status: READY)`);
        console.log(`\n⚠️  IMPORTANTE: El funder debe aprobar más USDC antes de ejecutar el batch nuevamente.\n`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

resetAndPauseBatch329();
