require('dotenv').config();
const { Pool } = require('pg');

async function migrate() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("🚀 Starting database migration: adding unique constraint to relayers.address...");

        // 1. Add unique constraint if not exists
        // Note: In Postgres, you can use 'ADD CONSTRAINT unique_relayer_address UNIQUE (address)'
        // but it's safer to check first or use a DO block.
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'relayers_address_key'
                ) THEN
                    ALTER TABLE relayers ADD CONSTRAINT relayers_address_key UNIQUE (address);
                END IF;
            END $$;
        `);

        console.log("✅ Migration successful: 'relayers_address_key' constraint verified.");
    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    } finally {
        await pool.end();
    }
}

migrate();
