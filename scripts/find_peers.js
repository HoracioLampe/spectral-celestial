
const { ethers } = require('ethers');
require('dotenv').config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");
const FAUCET_ADDR = "0x7f64ba53b2A3adA9D3157e6646159A522C05Ee41";
const TARGET_AMOUNT = "20.0";

async function findPeers() {
    console.log(`🔍 Searching for peer relayers funded with ${TARGET_AMOUNT} MATIC from ${FAUCET_ADDR}`);
    const latestBlock = await provider.getBlockNumber();
    const startBlock = latestBlock - 500;

    const ghostRelayers = [];

    for (let i = latestBlock; i >= startBlock; i--) {
        if ((latestBlock - i) % 50 === 0) console.log(`   > Scanning block ${i}...`);
        const block = await provider.getBlock(i, true);
        if (!block || !block.transactions) continue;

        for (const tx of block.transactions) {
            if (tx.from && tx.from.toLowerCase() === FAUCET_ADDR.toLowerCase()) {
                const amount = ethers.formatEther(tx.value);
                if (amount === TARGET_AMOUNT || amount.startsWith("20.")) {
                    console.log(`✨ Found Relayer: ${tx.to} | Amount: ${amount} | Block: ${i}`);
                    if (!ghostRelayers.includes(tx.to)) ghostRelayers.push(tx.to);
                }
            }
        }
    }

    console.log("\nFinal List of Ghost Relayers:");
    console.log(JSON.stringify(ghostRelayers, null, 2));
}

findPeers();
