
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");

async function findGhostRelayers() {
    try {
        // 1. Find the latest batch and its funder
        const batchRes = await pool.query('SELECT id, funder_address FROM batches ORDER BY id DESC LIMIT 1');
        if (batchRes.rows.length === 0) {
            console.log("No batches found.");
            return;
        }
        const { id: batchId, funder_address: funderAddress } = batchRes.rows[0];
        console.log(`Checking latest Batch ID: ${batchId}, Funder: ${funderAddress}`);

        // 2. Find the faucet for this funder
        const faucetRes = await pool.query('SELECT address FROM faucets WHERE LOWER(funder_address) = LOWER($1)', [funderAddress]);
        if (faucetRes.rows.length === 0) {
            console.log("No faucet found for this funder.");
            return;
        }
        const faucetAddress = faucetRes.rows[0].address;
        console.log(`Faucet Address: ${faucetAddress}`);

        // 3. Check relayers in DB for this batch
        const relayerRes = await pool.query('SELECT address FROM relayers WHERE batch_id = $1', [batchId]);
        console.log(`Relayers in DB for this batch: ${relayerRes.rows.length}`);
        relayerRes.rows.forEach(r => console.log(` - ${r.address}`));

        // 4. Trace transactions from Faucet to find funded addresses not in DB
        // We look for recent transfers. This is heuristic but usually works if done recently.
        console.log("\nSearching for recent transfers from Faucet...");
        const network = await provider.getNetwork();
        const latestBlock = await provider.getBlockNumber();

        // We query the last 100 blocks
        const filter = {
            fromBlock: latestBlock - 500,
            toBlock: 'latest',
            address: null, // Any address
            topics: [] // We'll just look at transactions if possible, but ethers logs are better for events.
            // Actually, we can just walk transactions in the last blocks or use an indexer.
            // Since we don't have an indexer, let's try to get the transaction history of the faucet address.
            // Ethers doesn't have a direct "get history" for a wallet address without an API key (like Etherscan).
        };

        console.log("Note: Detailed blockchain trace requires an indexer or scanning blocks manually.");
        console.log("Let's check if the relayer addresses were logged in server logs or if we can find them in Vault anyway.");

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

findGhostRelayers();
