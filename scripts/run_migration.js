const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("Running migration...");
        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS merkle_status VARCHAR(20) DEFAULT 'NOT_TESTED';
        `);
        console.log("✅ Migration successful: Added merkle_status column.");
    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
