const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runMigration() {
    try {
        console.log("Running migration: Add batch metrics columns...");
        const client = await pool.connect();

        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS total_gas_used VARCHAR(50),
            ADD COLUMN IF NOT EXISTS execution_time VARCHAR(50);
        `);

        console.log("✅ Columns 'total_gas_used' and 'execution_time' added.");
        client.release();
    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    } finally {
        await pool.end();
    }
}

runMigration();
