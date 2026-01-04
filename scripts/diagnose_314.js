
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function diagnose() {
    try {
        console.log("🔍 Diagnóstico detallado para Batch 314...");

        // Count by status
        const res = await pool.query(`
            SELECT status, COUNT(*) as count 
            FROM batch_transactions 
            WHERE batch_id = 314 
            GROUP BY status
        `);
        console.table(res.rows);

        // Show details of non-completed ones
        const pending = await pool.query(`
            SELECT id, status, wallet_address_to, tx_hash, updated_at
            FROM batch_transactions 
            WHERE batch_id = 314 AND status != 'COMPLETED'
            LIMIT 20
        `);
        console.log("\nEjemplo de transacciones no completadas:");
        console.table(pending.rows);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

diagnose();
