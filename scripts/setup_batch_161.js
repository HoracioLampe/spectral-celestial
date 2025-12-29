
const { Pool } = require('pg');
const { ethers } = require('ethers');
const path = require('path');
const RelayerEngine = require(path.join(__dirname, '../services/relayerEngine'));
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function setupBatch161() {
    console.log("🛠️ Starting Manual Setup for Batch 161...");

    // User provided key
    let faucetKey = "0x81091b2d5f240b671012b2fc90a2dd14ae31924572961ceb2c7db3a3e7480a65";
    console.log("✅ Using Provided Faucet Key.");


    try {
        console.log("🔍 Verifying Faucet connection...");
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(faucetKey, provider);
        console.log(`🔑 Wallet created: ${wallet.address}`);

        const balance = await provider.getBalance(wallet.address);
        console.log(`🏦 Faucet Balance: ${ethers.formatEther(balance)} MATIC`);

        if (balance < ethers.parseEther("0.1")) {
            console.error("❌ Faucet balance too low!");
            // process.exit(1); // Don't exit, try anyway?
        }

        console.log("⚙️  Initializing Engine...");
        const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

        // Prepare 5 Relayers
        console.log("🚀 Creating and Funding 5 Relayers...");
        const result = await engine.prepareRelayers(161, 5);

        console.log("✅ Setup Complete!", result);

    } catch (e) {
        console.error("❌ Setup Failed:", e);
    } finally {
        await pool.end();
    }
}

setupBatch161();
