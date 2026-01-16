const { ethers } = require('ethers');

async function testRPC() {
    const RPC_URL = "https://fluent-clean-orb.matic.quiknode.pro/d95e5af7a69e7b5f8c09a440a5985865d6f4ae93/";
    console.log(`🚀 Testing RPC: ${RPC_URL}`);

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        // 1. Get Network
        const network = await provider.getNetwork();
        console.log(`✅ Connected to Chain ID: ${network.chainId} (${network.name})`);

        // 2. Get Block Number
        const blockNumber = await provider.getBlockNumber();
        console.log(`📦 Latest Block Number: ${blockNumber}`);

        // 3. Simple balance check (Vitalik's address as a placeholder)
        const testAddress = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
        const balance = await provider.getBalance(testAddress);
        console.log(`💰 Balance of ${testAddress}: ${ethers.formatEther(balance)} MATIC`);

        console.log("\n✨ RPC test successful!");
    } catch (error) {
        console.error("\n❌ RPC test failed:");
        console.error(error);
    }
}

testRPC();
