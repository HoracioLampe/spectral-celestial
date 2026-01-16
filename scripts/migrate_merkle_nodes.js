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

        // 1. Remove from batches (optional, but cleaner)
        // await client.query(`ALTER TABLE batches DROP COLUMN IF EXISTS merkle_status;`);

        // 2. Add to merkle_nodes. Only leaves (level 0) really need it, but adding to table is fine.
        await client.query(`
            ALTER TABLE merkle_nodes 
            ADD COLUMN IF NOT EXISTS verified_on_chain BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMP;
        `);

        // 3. Reset all to FALSE
        await client.query(`UPDATE merkle_nodes SET verified_on_chain = FALSE`);

        console.log("✅ Migration successful: Added verified_on_chain to merkle_nodes.");
    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
