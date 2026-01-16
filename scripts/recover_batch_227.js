const { Pool } = require('pg');
const { ethers } = require('ethers');
const RelayerEngine = require('../services/relayerEngine');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const BATCH_ID = 229;

async function recover() {
    console.log(`🚑 STARTING RECOVERY FOR BATCH ${BATCH_ID}...`);

    // 1. Setup Engine & Faucet
    const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
    const faucetKey = faucetRes.rows[0]?.private_key;
    if (!faucetKey) throw new Error("No Faucet Private Key found.");

    const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

    try {
        // 2. Clear Stuck Faucet Queue (If any)
        console.log("🧹 Verifying Faucet Nonce...");
        await engine.verifyAndRepairNonce();

        // 3. Load Relayers
        const relayersRes = await pool.query('SELECT private_key, address FROM relayers WHERE batch_id = $1', [BATCH_ID]);
        const relayers = relayersRes.rows.map(r => new ethers.Wallet(r.private_key, engine.provider));
        console.log(`👷 Loaded ${relayers.length} relayers.`);

        if (relayers.length === 0) throw new Error("No relayers found for this batch.");

        // 4. Reset Stuck 'ENVIANDO' or 'FAILED' or 'WAITING_CONFIRMATION' to 'PENDING'
        // Reset status FIRST so that distributeGasToRelayers sees the pending work!
        console.log("🔄 Resetting any stuck 'ENVIANDO' or 'FAILED' or 'WAITING_CONFIRMATION' transactions...");
        await pool.query(`UPDATE batch_transactions SET status = 'PENDING', retry_count = 0 WHERE batch_id = $1 AND status IN ('ENVIANDO', 'FAILED', 'WAITING_CONFIRMATION', 'PENDING')`, [BATCH_ID]);

        // 5. Force Refunding (Distribute Gas)
        // Now that status is PENDING, estimation will work.
        console.log("⛽ Checking and Refilling Relayer Gas...");
        try {
            await engine.distributeGasToRelayers(BATCH_ID, relayers);
        } catch (e) {
            console.warn(`⚠️ Gas distribution warning: ${e.message}`);
        }

        // 6. Run Retry Phase
        console.log("🚀 Executing Retry Logic...");
        await engine.retryFailedTransactions(BATCH_ID, relayers);

        console.log("✅ Recovery Script Completed.");

    } catch (err) {
        console.error("❌ Recovery Failed:", err);
    } finally {
        await pool.end();
    }
}

recover();
