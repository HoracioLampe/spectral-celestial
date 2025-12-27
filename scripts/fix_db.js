const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function runFix() {
    const client = await pool.connect();
    try {
        console.log("Checking database schema...");

        // Add updated_at column to batches if it doesn't exist
        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
        `);

        console.log("✅ Column 'updated_at' ensured in 'batches' table.");

    } catch (err) {
        console.error("❌ Error fixing database:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

runFix();
