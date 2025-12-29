const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log("--- Checking 'batches' columns ---");
        const resCols = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'batches' 
            AND column_name IN ('total_gas_used', 'execution_time', 'start_time', 'end_time');
        `);
        console.table(resCols.rows);

        console.log("\n--- Checking 'batch_transactions' indices ---");
        const resIdx = await pool.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'batch_transactions'
            AND indexname IN ('idx_batch_tx_wallet_to', 'idx_batch_tx_status', 'idx_batch_tx_batch_id');
        `);
        console.table(resIdx.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
