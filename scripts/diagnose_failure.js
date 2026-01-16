require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function diagnose() {
    try {
        console.log("🔍 Diagnosing failed transactions in latest batch...");

        // Get latest batch
        const batchRes = await pool.query('SELECT id FROM batches ORDER BY id DESC LIMIT 1');
        if (batchRes.rows.length === 0) {
            console.log("No batches found.");
            return;
        }
        const batchId = batchRes.rows[0].id;
        console.log(`Latest Batch ID: ${batchId}`);

        // Get failed txs
        const res = await pool.query(`
            SELECT id, wallet_address_to, amount_usdc, status, updated_at 
            FROM batch_transactions 
            WHERE batch_id = $1 AND status = 'FAILED'
        `, [batchId]);

        if (res.rows.length === 0) {
            console.log("✅ No failed transactions found in this batch.");
        } else {
            console.log(`❌ Found ${res.rows.length} failed transactions:`);
            console.table(res.rows);

            // Try to find if there are any error logs (if we had a logs table, but we don't. 
            // We usually just set status. We might want to add an 'error_message' column in the future).
            console.log("Note: Detailed error messages are currently logged to console/Railway logs, not persisted in DB (unless 'error_message' column exists).");
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

diagnose();
