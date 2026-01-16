require('dotenv').config();
const { Pool } = require('pg');
const ethers = require('ethers');
const RelayerEngine = require('../services/relayerEngine');
const RpcManager = require('../services/rpcManager');
const vault = require('../services/vault');

// Helper to get Faucet credentials based on Funder Address
async function getFaucetCredentials(funderAddress) {
    if (!funderAddress) throw new Error("Funder address required");

    // 1. Get Public Address from DB
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const res = await pool.query('SELECT address FROM faucets WHERE LOWER(funder_address) = $1', [funderAddress.toLowerCase()]);
    await pool.end();

    if (res.rows.length === 0) {
        throw new Error(`No faucet found for funder ${funderAddress}`);
    }

    const faucetAddress = res.rows[0].address;

    // 2. Get Private Key from Vault
    const privateKey = await vault.getFaucetKey(faucetAddress);
    if (!privateKey) throw new Error(`Faucet key not found in Vault for ${faucetAddress}`);

    return privateKey;
}

async function run() {
    console.log("🛠️ Starting Recovery Debug Script...");

    // 1. Setup Dependencies
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const rpcUrl = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
    const fallbackUrl = process.env.RPC_URL_FALLBACK;

    const rpcManager = new RpcManager(rpcUrl, fallbackUrl);
    // await rpcManager.initialize(); // RpcManager doesn't seem to have initialize() based on code view

    // 2. Identify a Target Batch (Batch 343 or similar)
    const batchId = 343; // Hardcoded mostly for testing, can be arg
    console.log(`🎯 Targeting Batch ${batchId}`);

    try {
        // 3. Get Funder & Init Engine
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) throw new Error("Batch not found");

        const funderAddr = batchRes.rows[0].funder_address;
        console.log(`👤 Funder: ${funderAddr}`);

        const faucetPk = await getFaucetCredentials(funderAddr);
        const engine = new RelayerEngine(pool, rpcManager, faucetPk);

        // 4. Run Recovery Manually
        console.log("🚀 Invoking returnFundsToFaucet...");
        const result = await engine.returnFundsToFaucet(batchId);

        console.log("✅ Recovery Result:", result);

    } catch (err) {
        console.error("❌ Debug Script Failed:", err);
    } finally {
        await pool.end();
    }
}

run();
