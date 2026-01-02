const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function normalizeDatabase() {
    const client = await pool.connect();
    console.log("🔄 Starting Database Normalization (Lowercasing Addresses)...");

    try {
        await client.query('BEGIN');

        // 1. RBAC Users
        console.log("Updating rbac_users...");
        await client.query(`UPDATE rbac_users SET address = LOWER(address)`);

        // 2. Batches
        console.log("Updating batches (funder_address)...");
        await client.query(`UPDATE batches SET funder_address = LOWER(funder_address)`);

        // 3. Faucets
        console.log("Updating faucets (funder_address)...");
        await client.query(`UPDATE faucets SET funder_address = LOWER(funder_address)`);

        // 4. Batch Transactions (Optional but good for search)
        console.log("Updating batch_transactions (wallet_address_to)...");
        await client.query(`UPDATE batch_transactions SET wallet_address_to = LOWER(wallet_address_to)`);

        await client.query('COMMIT');
        console.log("✅ Database Normalization Complete.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Error during normalization:", e);
    } finally {
        client.release();
        pool.end();
    }
}

normalizeDatabase();
