
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanup() {
    const client = await pool.connect();
    try {
        console.log("🧹 Starting Cleanup: Deleting 'READY', 'SENT', and 'PREPARING' batches...");

        await client.query('BEGIN');

        // 1. Identify Batches to Delete
        // User requested: En Preparacion (PREPARING), Enviando (SENT), Preparado (READY)
        const res = await client.query(`
            SELECT id, batch_number, status, created_at 
            FROM batches 
            WHERE status IN ('READY', 'SENT', 'PREPARING')
        `);

        if (res.rowCount === 0) {
            console.log("✨ No batches found to clean up.");
            await client.query('ROLLBACK');
            return;
        }

        const ids = res.rows.map(r => r.id);
        console.log(`Found ${res.rowCount} batches to delete. Sample IDs:`, ids.slice(0, 5));

        // 2. Delete Related Transactions (Orphans)
        const txRes = await client.query(`
            DELETE FROM batch_transactions 
            WHERE batch_id = ANY($1::int[])
        `, [ids]);
        console.log(`🗑️  Deleted ${txRes.rowCount} orphan transactions.`);

        // 3. Delete Batches
        const batchRes = await client.query(`
            DELETE FROM batches 
            WHERE id = ANY($1::int[])
        `, [ids]);
        console.log(`🗑️  Deleted ${batchRes.rowCount} batches.`);

        await client.query('COMMIT');
        console.log("✅ Cleanup Successful.");

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Cleanup Failed:", e.message);
    } finally {
        client.release();
        pool.end();
    }
}

cleanup();
