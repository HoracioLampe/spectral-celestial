const { RpcManager } = require('../services/rpcManager');
const dotenv = require('dotenv');
const { ethers } = require('ethers');

dotenv.config();

async function verifyResilience() {
    console.log("🚀 Starting Resilient RPC Verification...");

    const rpcUrls = [
        process.env.PROVIDER_URL || "https://polygon-rpc.com",
        "https://invalid-rpc-url-test.com", // Force a failure if used
        "https://rpc-mainnet.maticvigil.com"
    ].filter(Boolean);

    const rpcManager = new RpcManager(rpcUrls);

    try {
        console.log("📡 Testing multi-RPC execution...");
        const blockNumber = await rpcManager.execute(async (provider) => {
            console.log(`🔗 Attempting with provider...`);
            return await provider.getBlockNumber();
        });
        console.log(`✅ Successfully fetched block number: ${blockNumber}`);

        console.log("💰 Testing balance fetching (resilient)...");
        const testAddress = "0x000000000000000000000000000000000000dead";
        const balance = await rpcManager.execute(async (provider) => {
            return await provider.getBalance(testAddress);
        });
        console.log(`✅ Successfully fetched balance: ${ethers.formatEther(balance)} MATIC`);

        console.log("\n✨ Verification PASSED: RPC Manager is resilient and functional.");
    } catch (err) {
        console.error("\n❌ Verification FAILED:", err.message);
        process.exit(1);
    }
}

verifyResilience();
