require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixDrainedStatus() {
    console.log("🛠️ Starting Retroactive Drained Status Fix...");
    try {
        // Query to find relayers with dust balance (< 0.05 MATIC) that are not yet marked as drained
        // Using string comparison for balance to be safe or float casting
        const res = await pool.query(`
            UPDATE relayers 
            SET status = 'drained', last_activity = NOW()
            WHERE status != 'drained' 
            AND (CAST(last_balance AS DOUBLE PRECISION) < 0.05)
        `);

        console.log(`✅ Success! Marked ${res.rowCount} relayers as 'drained'.`);
        console.log("Please refresh the UI to see the relayers greyed out with 0.00 MATIC.");
    } catch (err) {
        console.error("❌ Error running fix:", err);
    } finally {
        await pool.end();
    }
}

fixDrainedStatus();
