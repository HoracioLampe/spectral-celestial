const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const client = await pool.connect();
    try {
        console.log("🔌 Connected to DB. Adding gas tracking columns...");

        await client.query('BEGIN');

        // Add funding_amount
        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS funding_amount NUMERIC DEFAULT 0;
        `);

        // Add refund_amount
        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS refund_amount NUMERIC DEFAULT 0;
        `);

        await client.query('COMMIT');
        console.log("✅ Columns added: funding_amount, refund_amount");

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Error:", err);
    } finally {
        client.release();
        pool.end();
    }
}

run();
