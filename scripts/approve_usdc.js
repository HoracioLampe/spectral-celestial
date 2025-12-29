
const { ethers } = require('ethers');
require('dotenv').config();

// Configuration
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"; // USDC Native Polygon
const DISTRIBUTOR_ADDRESS = "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5"; // Deployed Contract

async function resetAndApprove() {
    console.log("🔧 Starting USDC Allowance Reset...");

    // 1. Setup Provider & Wallet
    // Checking for FUNDER key, fallback to FAUCET key if not present (often same in tests)
    const privateKey = process.env.FUNDER_PRIVATE_KEY || process.env.FAUCET_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("❌ Missing FUNDER_PRIVATE_KEY or FAUCET_PRIVATE_KEY in .env");
    }

    const providerUrl = process.env.PROVIDER_URL || "https://polygon-rpc.com";
    const provider = new ethers.JsonRpcProvider(providerUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`👤 Funder: ${wallet.address}`);

    // 2. Connect to USDC
    const abi = ["function approve(address spender, uint256 amount) public returns (bool)", "function allowance(address owner, address spender) public view returns (uint256)"];
    const usdc = new ethers.Contract(USDC_ADDRESS, abi, wallet);

    // 3. Check Current Allowance
    const currentAllowance = await usdc.allowance(wallet.address, DISTRIBUTOR_ADDRESS);
    console.log(`📊 Current Allowance: ${ethers.formatUnits(currentAllowance, 6)} USDC`);

    // 4. Reset to 0 (Clean State)
    if (currentAllowance > 0n) {
        console.log(`🔄 Resetting allowance to 0...`);
        try {
            const tx0 = await usdc.approve(DISTRIBUTOR_ADDRESS, 0);
            console.log(`   > Tx Sent: ${tx0.hash}`);
            await tx0.wait();
            console.log(`   ✅ Reset Confirmed.`);
        } catch (e) {
            console.error(`   ⚠️ Reset failed (Standard ERC20s might not need this): ${e.message}`);
        }
    }

    // 5. Set Infinite Allowance
    console.log(`🔓 Setting Infinite Allowance...`);
    const txApprove = await usdc.approve(DISTRIBUTOR_ADDRESS, ethers.MaxUint256);
    console.log(`   > Tx Sent: ${txApprove.hash}`);
    await txApprove.wait();
    console.log(`✅ Allowance Updated to MAX.`);

    // 6. Verify
    const newAllowance = await usdc.allowance(wallet.address, DISTRIBUTOR_ADDRESS);
    console.log(`🎉 New Allowance: ${ethers.formatUnits(newAllowance, 6)} USDC`);
}

resetAndApprove().catch(console.error);
