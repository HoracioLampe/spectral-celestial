const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetMerkleData() {
    const client = await pool.connect();
    try {
        console.log("⚠️  TRUNCATING `merkle_nodes` and resetting `merkle_root` in `batches`...");

        await client.query('BEGIN');

        // 1. Delete all nodes
        await client.query('TRUNCATE TABLE merkle_nodes RESTART IDENTITY');

        // 2. Clear roots in batches
        await client.query('UPDATE batches SET merkle_root = NULL');

        await client.query('COMMIT');

        console.log("✅ Database Merkle data reset complete.");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Reset failed:", err);
    } finally {
        client.release();
        pool.end();
    }
}

resetMerkleData();
