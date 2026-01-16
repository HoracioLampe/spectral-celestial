
const { ethers } = require('ethers');
require('dotenv').config();

const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const provider = new ethers.JsonRpcProvider(providerUrl);

// The Faucet Address in question
const FAUCET_ADDR = '0xB4C367834e3Ea0B85dbC50846A9A6A3c40DFb259';

async function scanNonce() {
    console.log(`🔎 Scanning output transactions for ${FAUCET_ADDR}...`);

    // Get current nonce
    const nonce = await provider.getTransactionCount(FAUCET_ADDR);
    console.log(`Current Nonce: ${nonce}`);

    // Since we can't query by sender efficiently without an indexer,
    // and "getHistory" is not standard RPC...
    // We are severely limited here unless we have the Hash.

    // BUT, the user said "42 minutes ago".
    // We can check the BALANCE now.
    const balance = await provider.getBalance(FAUCET_ADDR);
    console.log(`Current Balance: ${ethers.formatEther(balance)} POL`);

    // We can also try to "Replay" recent blocks to finding txs from this sender
    // This is slow but feasible for "42 minutes" (~1000 blocks)

    const latestBlock = await provider.getBlockNumber();
    const blocksToScan = 200; // Let's try last 200 blocks first (approx 10 mins). If not found, user might be off on time.
    // Actually 42 mins is ~1200 blocks. Let's do a sample check.

    console.log(`Scanning last ${blocksToScan} blocks for sender ${FAUCET_ADDR}...`);

    let found = false;
    for (let i = 0; i < blocksToScan; i++) {
        const blockNum = latestBlock - i;
        // console.log(`Checking Block ${blockNum}...`);

        try {
            // Get block with transactions
            const block = await provider.getBlock(blockNum, true);
            if (!block || !block.prefetchedTransactions) continue;

            for (const tx of block.prefetchedTransactions) {
                if (tx.from.toLowerCase() === FAUCET_ADDR.toLowerCase()) {
                    console.log(`\n🚨 FOUND TX in Block ${blockNum}:`);
                    console.log(`Hash: ${tx.hash}`);
                    console.log(`To: ${tx.to}`);
                    console.log(`Value: ${ethers.formatEther(tx.value)} POL`);
                    if (tx.to && tx.to.toLowerCase() === '0x1cc87a77516f41f17f2d91c57dae1d00b263f2b0') {
                        console.log("🎯 MATCH!! This is the transaction to 0x1cc8...");
                        found = true;
                    }
                }
            }
        } catch (e) {
            // ignore block fetch errors
        }

        if (found) break; // Stop if found
        if (i % 50 === 0) console.log(`...scanned ${i} blocks...`);
    }

    if (!found) console.log("❌ Transaction not found in recent blocks (Scan limit reached).");
}

scanNonce();
