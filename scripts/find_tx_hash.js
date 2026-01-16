
const { ethers } = require('ethers');
require('dotenv').config();

const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const provider = new ethers.JsonRpcProvider(providerUrl);

const faucetAddress = '0xB4C367834e3Ea0B85dbC50846A9A6A3c40DFb259';
const targetAmount = ethers.parseEther("1096.05333736"); // Approximate known amount
// We'll search for exact match or close match

async function findTx() {
    console.log(`🔎 Searching for tx from ${faucetAddress} with value ~1096.05 POL...`);

    // We can't query the chain easily by value without an indexer.
    // However, if the user says "42 minutes ago", we can look at the latest blocks.

    const latestBlock = await provider.getBlockNumber();
    // Polygon block time ~2s. 42 mins = 2520 seconds = ~1260 blocks.
    // Let's search last 2000 blocks to be safe.

    const startBlock = latestBlock - 2000;

    // We will scan block by block (inefficient but works for small range) -> TOO SLOW for simple checks
    // BETTER: Get nonce and check recent transactions of the sender if provider supports it?
    // Providers usually don't support "getHistory".

    // OPTION 2: If we have PolygonScan API key? No.

    // OPTION 3: Check NONCE. The user said "42 mins ago".
    const txCount = await provider.getTransactionCount(faucetAddress);
    console.log(`Current Nonce: ${txCount}`);

    // Check the last few defined transactions if we can guess the nonce...
    // Actually, we can just try to fetch transaction by nonce if we knew it.

    // HACK: Since we don't have an indexer, we can't easily find the hash just by "amount".
    // BUT we can check if we logged it in our DB 'relayers' table?
    // Maybe it was recorded as a "drain" transaction?

    // Let's first dump DB 'relayers' looking for that transactionhash_deposit or something
    console.log("Checking DB for known hashes...");
}

findTx();
