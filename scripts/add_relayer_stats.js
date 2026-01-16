require('dotenv').config();
const { Pool } = require('pg');

async function migrateRelayerStats() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("🚀 Starting migration: adding stats columns to relayers table...");

        await pool.query(`
            ALTER TABLE relayers 
            ADD COLUMN IF NOT EXISTS gas_cost VARCHAR(50),
            ADD COLUMN IF NOT EXISTS drain_balance VARCHAR(50);
        `);

        console.log("✅ Migration successful: 'gas_cost' and 'drain_balance' columns added.");
    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    } finally {
        await pool.end();
    }
}

migrateRelayerStats();
