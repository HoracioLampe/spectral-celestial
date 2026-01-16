
const { Pool } = require('pg');
const { ethers } = require('ethers');
const path = require('path');
const RelayerEngine = require('../services/relayerEngine');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const batchId = 167;

async function megaRetry() {
    console.log(`🚀 STARTING MEGA-RETRY FOR BATCH ${batchId} (Target: Up to 50 Retries)`);

    try {
        // 1. Reset Transactions
        console.log("🧹 Resetting FAILED transactions to PENDING status and 0 retries...");
        const resetRes = await pool.query(
            `UPDATE batch_transactions 
             SET status = 'PENDING', retry_count = 0 
             WHERE batch_id = $1 AND status = 'FAILED'`,
            [batchId]
        );
        console.log(`✅ ${resetRes.rowCount} transactions reset.`);

        // 2. Fetch Faucet
        const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
        const faucetKey = faucetRes.rows[0]?.private_key;
        if (!faucetKey) throw new Error("No Faucet Private Key found in DB.");

        // 3. Instantiate Engine
        const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

        // 4. Fetch Relayers
        const relayersRes = await pool.query('SELECT private_key FROM relayers WHERE batch_id = $1', [batchId]);
        const relayers = relayersRes.rows.map(r => new ethers.Wallet(r.private_key, engine.provider));
        console.log(`👷 Loaded ${relayers.length} relayers.`);

        // 5. Initial Funding Check (Avoid failing due to empty relayers)
        console.log("💰 Checking relayer funding before start...");
        await engine.distributeGasToRelayers(batchId, relayers);

        // 6. Run Mega-Retry Loop
        console.log("🔥 Initiating Recovery Loop (MAX_RETRIES: 50)...");
        await engine.retryFailedTransactions(batchId, relayers);

        console.log("\n🎉 MEGA-RETRY SEQUENCE FINISHED.");

        // Final Status Report
        const finalStats = await pool.query(
            `SELECT status, COUNT(*) FROM batch_transactions WHERE batch_id = $1 GROUP BY status`,
            [batchId]
        );
        console.log("📊 Final Status Report:", finalStats.rows);

    } catch (err) {
        console.error("❌ Mega-Retry CRASHED:", err);
    } finally {
        await pool.end();
    }
}

megaRetry();
