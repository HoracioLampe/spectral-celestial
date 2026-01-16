require('dotenv').config();
const { ethers } = require('ethers');

async function analyze() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

    console.log("🔍 Analyzing Gas Health & Configuration...");

    // 1. Get Network Status
    const feeData = await provider.getFeeData();
    const currentGasPrice = feeData.gasPrice;

    console.log(`\n🌐 Network Status:`);
    console.log(`   Current Gas Price: ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);

    // 2. Get Configured Limits
    const envMax = process.env.MAX_GAS_PRICE_GWEI || "Not Set (Defaults to 3000)";
    console.log(`\n⚙️  Configuration (.env):`);
    console.log(`   MAX_GAS_PRICE_GWEI: ${envMax}`);

    // 3. Simulate "Noon" Logic vs "Hardened" Logic

    // Scenario: Execution Transaction (2.0x boost)
    const boostedPrice = (currentGasPrice * 200n) / 100n;
    console.log(`\n🚀 Simulation - Execution Tx (2.0x Boost):`);
    console.log(`   Required Price: ${ethers.formatUnits(boostedPrice, 'gwei')} gwei`);

    let limit;
    if (process.env.MAX_GAS_PRICE_GWEI) {
        limit = BigInt(process.env.MAX_GAS_PRICE_GWEI) * 1000000000n;
    } else {
        limit = 3000000000000n; // 3000 gwei default
    }

    console.log(`   Effective Cap: ${ethers.formatUnits(limit, 'gwei')} gwei`);

    if (boostedPrice > limit) {
        console.log(`   ❌ RESULT: CAPPED. Transaction would be sent at ${ethers.formatUnits(limit, 'gwei')} gwei.`);
        console.log(`      Risk: If network is ${ethers.formatUnits(currentGasPrice, 'gwei')}, sending at ${ethers.formatUnits(limit, 'gwei')} is UNDERPRICED.`);
        if (limit < currentGasPrice) {
            console.log("      CRITICAL: Cap is below BASE network price. Transaction will likely never mine or throw 'replacement underpriced' immediately.");
        }
    } else {
        console.log(`   ✅ RESULT: OK. Transaction sent at ${ethers.formatUnits(boostedPrice, 'gwei')} gwei.`);
    }

}

analyze();
