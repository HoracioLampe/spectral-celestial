const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log("Creating Indices for Batch Transactions...");

        // Index on Wallet Address (To)
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_batch_tx_wallet_to 
            ON batch_transactions(wallet_address_to);
        `);
        console.log("✅ Index created: idx_batch_tx_wallet_to");

        // Index on Status
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_batch_tx_status 
            ON batch_transactions(status);
        `);
        console.log("✅ Index created: idx_batch_tx_status");

        // Index on Batch ID (already likely exists implicitly or explicitly, but good to ensure for the base query)
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_batch_tx_batch_id 
            ON batch_transactions(batch_id);
        `);
        console.log("✅ Index created: idx_batch_tx_batch_id");

    } catch (e) {
        console.error("Error creating indices:", e);
    } finally {
        await pool.end();
    }
}

run();
