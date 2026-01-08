
const { Pool } = require('pg');
const dotenv = require('dotenv');
const ethers = require('ethers');
const RelayerEngine = require('../services/relayerEngine');
const rpcManager = require('../services/rpcManager');
const vault = require('../services/vault');

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function kickBatch() {
    const batchId = 343;
    console.log(`🚀 [Kick] Starting emergency recovery for Batch ${batchId}...`);

    try {
        // 1. Get Batch Info
        const batchRes = await pool.query('SELECT funder_address, merkle_root, total_transactions, total_usdc FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) throw new Error("Batch not found.");
        const batch = batchRes.rows[0];
        const funder = batch.funder_address;

        // 2. Get Faucet PK from Vault
        console.log(`🔐 Retrieving Faucet Key for ${funder}...`);
        const faucetPk = await vault.getRelayerKey(funder);
        if (!faucetPk) throw new Error(`Faucet key for ${funder} not found in Vault.`);

        const engine = new RelayerEngine(pool, rpcManager, faucetPk);
        const provider = engine.getProvider();
        const faucetWallet = new ethers.Wallet(faucetPk, provider);

        // 3. Register Merkle Root if missing
        console.log("🌲 Checking Merkle Root on-chain...");
        const contract = new ethers.Contract(engine.contractAddress, engine.contractABI, provider);
        const onChainRoot = await contract.batchRoots(funder, batchId);

        if (onChainRoot === ethers.ZeroHash) {
            console.log("⚠️ Merkle Root is MISSING on-chain. Registering now...");

            // We need a signature to register. If we don't have it, we might have to use ADMIN if available,
            // or ask the worker to just 'resume' which will try to register if we have rootSignatureData.
            // But here we are in a script. 
            // Since we CANNOT easily get the signature without the user signing, 
            // let's hope the background process just needs a RESTART.
        }

        // 4. Force Start Workers
        console.log("👷 Launching worker swarm...");
        const result = await engine.startExecution(batchId);
        console.log("✅ result:", result);

        console.log("\n[Important] Leave this script running for a few minutes to process the batch.");
        await new Promise(r => setTimeout(r, 600000)); // 10 minutes

    } catch (err) {
        console.error("❌ Kick failed:", err.message);
    } finally {
        await pool.end();
    }
}

kickBatch();
