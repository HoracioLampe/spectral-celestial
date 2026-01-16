const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function revert247() {
    try {
        console.log("↩️ Reverting Batch 247 to COMPLETED...");
        await pool.query(`UPDATE batches SET status = 'COMPLETED' WHERE id = 247`);
        console.log("✅ Batch 247 status set to COMPLETED.");
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

revert247();
