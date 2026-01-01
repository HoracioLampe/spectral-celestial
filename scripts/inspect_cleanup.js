require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkCandidates() {
    try {
        console.log("🔍 Analizando candidatos para borrado...");

        // 1. Check Orphan Transactions
        const orphansRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM batch_transactions 
            WHERE batch_id NOT IN (SELECT id FROM batches)
        `);
        console.log(`\n👻 Transacciones Huérfanas encontradas: ${orphansRes.rows[0].count}`);

        // 2. Check "No Duration" Batches
        // We look for batches where execution_time is null/empty
        const noDurRes = await pool.query(`
            SELECT id, batch_number, status, created_at, execution_time 
            FROM batches 
            WHERE execution_time IS NULL OR execution_time = ''
        `);

        console.log(`\n⚠️ Batches SIN duración (${noDurRes.rows.length}):`);
        if (noDurRes.rows.length > 0) {
            console.table(noDurRes.rows.map(b => ({
                ID: b.id,
                Status: b.status,
                Created: b.created_at,
                ExecTime: b.execution_time
            })));
        }

        console.log("\n❓ ¿Confirmar borrado? (Se borrarán orphans y estos batches)");

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

checkCandidates();
