
const { ethers } = require('ethers');

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function testRpc() {
    console.log(`🔌 Connecting to Chainstack RPC...`);
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        const blockNumber = await provider.getBlockNumber();
        console.log(`✅ Connection Success! Current Block: ${blockNumber}`);

        const feeData = await provider.getFeeData();
        console.log(`⛽ Gas Price: ${ethers.formatUnits(feeData.gasPrice, 'gwei')} gwei`);

        const network = await provider.getNetwork();
        console.log(`🌍 Network: ${network.name} (Chain ID: ${network.chainId})`);

    } catch (e) {
        console.error(`❌ RPC Connection Failed: ${e.message}`);
    }
}

testRpc();
