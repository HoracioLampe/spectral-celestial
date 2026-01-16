
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function optimize() {
    const client = await pool.connect();
    try {
        console.log("🚀 Optimizing 'batch_transactions' table...");

        const indices = [
            // 1. Status (Heavily used for filtering pending/completed)
            `CREATE INDEX IF NOT EXISTS idx_bt_status ON batch_transactions (status)`,

            // 2. Tx Hash (Critical for lookups by hash)
            `CREATE INDEX IF NOT EXISTS idx_bt_tx_hash ON batch_transactions (tx_hash)`,

            // 3. Recipient Address (Correct column name is 'wallet_address_to')
            `CREATE INDEX IF NOT EXISTS idx_bt_recipient ON batch_transactions (wallet_address_to)`,
            `CREATE INDEX IF NOT EXISTS idx_bt_recipient_lower ON batch_transactions (LOWER(wallet_address_to))`,

            // 4. Batch ID (likely exists, but ensuring for JOINs)
            `CREATE INDEX IF NOT EXISTS idx_bt_batch_id ON batch_transactions (batch_id)`,

            // 5. Composite: batch_id + status (For RelayerEngine queue fetching)
            `CREATE INDEX IF NOT EXISTS idx_bt_batch_status ON batch_transactions (batch_id, status)`
        ];

        for (const query of indices) {
            console.log(`Executing: ${query}`);
            await client.query(query);
        }

        console.log("✅ 'batch_transactions' indices applied successfully.");

    } catch (e) {
        console.error("❌ Optimization Failed:", e.message);
    } finally {
        client.release();
        pool.end();
    }
}

optimize();
