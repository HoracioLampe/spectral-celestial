const { Pool } = require('pg');
const { ethers } = require('ethers');
const path = require('path');
const RelayerEngine = require(path.join(__dirname, '../services/relayerEngine'));
require('dotenv').config();

// Mock Pool/Provider for the Engine
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const provider = new ethers.JsonRpcProvider(RPC_URL);
console.log(`🔌 Connected to Chainstack RPC for Rescue Operation.`);


async function forceRetry() {
    const batchId = process.argv[2];
    if (!batchId) {
        console.error("❌ Usage: node scripts/force_retry_batch.js <batch_id>");
        process.exit(1);
    }

    console.log(`🚑 FORCING RETRY for Batch ${batchId}...`);

    // Instantiate Engine (Correct Signature: pool, providerUrl, faucetKey)
    const faucetKey = process.env.FAUCET_PRIVATE_KEY;
    if (!faucetKey) {
        console.error("❌ FAUCET_PRIVATE_KEY is missing in .env");
        process.exit(1);
    }
    const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

    // We need relayers. Fetch them from DB.
    const relayersRes = await pool.query('SELECT address, private_key FROM relayers WHERE batch_id = $1', [batchId]);
    if (relayersRes.rows.length === 0) {
        console.error("❌ No relayers found for this batch.");
        process.exit(1);
    }

    const relayers = relayersRes.rows.map(r => new ethers.Wallet(r.private_key, provider));
    console.log(`👉 Loaded ${relayers.length} relayers.`);

    try {
        await engine.retryFailedTransactions(batchId, relayers);
        console.log("✅ Retry Sequence Completed.");
    } catch (e) {
        console.error("❌ Retry Failed:", e);
    } finally {
        await pool.end();
    }
}

forceRetry();
