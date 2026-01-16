require('dotenv').config({ path: '../.env' }); // Adjust path if running from scripts/
const { ethers } = require('ethers');
const RpcManager = require('../services/rpcManager');

// Mock Config
const RPC_PRIMARY = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
// Use the failing one to demonstrate the issue
const RPC_FALLBACK = "https://polygon-rpc.com";

async function testConnection(name, url) {
    if (!url) return console.log(`[${name}] ❌ No URL configured.`);

    console.log(`[${name}] Testing connection to: ${url}...`);
    try {
        const provider = new ethers.JsonRpcProvider(url);
        const block = await provider.getBlockNumber();
        console.log(`[${name}] ✅ Success! Block Height: ${block}`);
        return true;
    } catch (err) {
        console.log(`[${name}] ❌ FAILED:`, err.message);
        if (err.info && err.info.responseStatus) {
            console.log(`[${name}]    > Response Status: ${err.info.responseStatus}`);
        }
        return false;
    }
}

async function verifyLogic() {
    console.log("\n--- Testing Failover Logic ---");
    const manager = new RpcManager(RPC_PRIMARY, RPC_FALLBACK);

    // Simulate Critical Error
    const fakeError = new Error("Simulated Error: -32005 Limit Exceeded");
    fakeError.error = { code: -32005 };

    console.log(`[Logic] Simulating Critical Error on Primary...`);

    const handled = manager.handleError(fakeError);

    if (handled) {
        console.log(`[Logic] ✅ Error was handled.`);
        if (manager.isFallback) {
            console.log(`[Logic] ✅ System successfully switched to Fallback mode.`);
            console.log(`[Logic]    > Current Provider URL: ${manager.currentUrl}`);
        } else {
            console.log(`[Logic] ❌ System did NOT switch to fallback. (Check logic)`);
        }
    } else {
        console.log(`[Logic] ❌ Error was NOT handled.`);
    }

    // Try to Execute with the (now fallback) provider
    console.log("\n--- Attempting Real Execution on Active Provider ---");
    try {
        const block = await manager.execute(async (provider) => {
            return await provider.getBlockNumber();
        });
        console.log(`[Execution] ✅ Success! Block: ${block}`);
    } catch (err) {
        console.log(`[Execution] ❌ Failed to execute on Active Provider.`);
        console.log(`[Execution]    > Error: ${err.message}`);
    }
}

async function main() {
    console.log("=== RPC MONITOR ===");
    await testConnection("PRIMARY", RPC_PRIMARY);
    await testConnection("FALLBACK", RPC_FALLBACK);
    await verifyLogic();
}

main().catch(console.error);
