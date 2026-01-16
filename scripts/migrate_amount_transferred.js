require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("🔍 Checking amount_transferred column...");
        await pool.query(`
            ALTER TABLE batch_transactions 
            ADD COLUMN IF NOT EXISTS amount_transferred VARCHAR(255);
        `);
        console.log("✅ Column checked/added.");
    } catch (err) {
        console.error("❌ Migration failed:", err);
    } finally {
        await pool.end();
    }
}

migrate();
