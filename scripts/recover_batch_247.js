const ethers = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const QUICKNODE_TEST_URL = "https://polygon-bor-rpc.publicnode.com";

async function recover() {
    try {
        console.log("📡 Testing QuickNode Connection...");
        const provider = new ethers.JsonRpcProvider(QUICKNODE_TEST_URL);
        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ QuickNode Online! Current Block: ${blockNumber}`);

        console.log("\n🛠️ Resetting Batch 247 to EXECUTING...");
        // 1. Reset Batch Status
        await pool.query(`UPDATE batches SET status = 'EXECUTING' WHERE id = 247`);

        // 2. Reset Stuck Transactions
        const resetRes = await pool.query(`
            UPDATE batch_transactions 
            SET status = 'PENDING', relayer_address = NULL, tx_hash = NULL, updated_at = NOW() 
            WHERE batch_id = 247 AND status = 'ENVIANDO'
        `);
        console.log(`✅ Reset ${resetRes.rowCount} transactions from ENVIANDO to PENDING.`);

    } catch (e) {
        console.error("❌ Connection Failed:", e.message);
    } finally {
        await pool.end();
    }
}

recover();
