
const { ethers } = require('ethers');
require('dotenv').config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");
const FAUCET_ADDR = "0x7f64ba53b2A3adA9D3157e6646159A522C05Ee41";

async function trace() {
    console.log(`🔍 Tracing transfers from Faucet: ${FAUCET_ADDR}`);
    const latestBlock = await provider.getBlockNumber();
    const startBlock = latestBlock - 200; // Scan last 200 blocks (~6 mins)

    console.log(`Scanning blocks ${startBlock} to ${latestBlock}...`);

    for (let i = latestBlock; i >= startBlock; i--) {
        if ((latestBlock - i) % 100 === 0) console.log(`   > Checking block ${i}...`);
        const block = await provider.getBlock(i, true);
        if (!block || !block.transactions) continue;

        for (const tx of block.transactions) {
            if (tx.from && tx.from.toLowerCase() === FAUCET_ADDR.toLowerCase()) {
                console.log(`✨ Found Transfer! To: ${tx.to} | Value: ${ethers.formatEther(tx.value)} MATIC | Hash: ${tx.hash}`);
            }
        }
    }
}

trace();
