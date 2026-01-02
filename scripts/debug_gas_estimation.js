const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

async function debugGas(batchId) {
    try {
        console.log(`Analyzing Batch ${batchId}...`);

        // 1. Check Tx Count
        const txRes = await pool.query('SELECT id, amount_usdc, wallet_address_to FROM batch_transactions WHERE batch_id = $1 AND status = $2', [batchId, 'PENDING']);
        console.log(`Pending Transactions: ${txRes.rows.length}`);

        if (txRes.rows.length === 0) return;

        // 2. Check Gas Price
        const feeData = await provider.getFeeData();
        console.log(`Gas Price (RPC): ${ethers.formatUnits(feeData.gasPrice || 0, 'gwei')} gwei`);
        console.log(`Gas Price (Raw): ${feeData.gasPrice}`);

        // 3. Estimate Gas for Sample
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funder = batchRes.rows[0]?.funder_address;
        console.log(`Funder: ${funder}`);

        const contractAddress = process.env.CONTRACT_ADDRESS; // Ensure this is set or hardcode if needed
        // Just use dummy estimate if contract addr missing for debug script
        // But better to check env.

        console.log(`Contract: ${contractAddress}`);

        // Fallback for logic simulation
        const averageGas = 150000n;
        console.log(`Simulated Average Gas: ${averageGas}`);

        const txCount = BigInt(txRes.rows.length);
        const bufferPercent = 60n;

        const bufferedGas = (averageGas * txCount) * (100n + bufferPercent) / 100n;
        console.log(`Buffered Gas Total: ${bufferedGas}`);

        const gasPrice = feeData.gasPrice || 50000000000n;
        const safetyCushion = ethers.parseEther("0.25");

        const totalCost = (bufferedGas * gasPrice) + safetyCushion;
        console.log(`Total Cost (Wei): ${totalCost}`);
        console.log(`Total Cost (MATIC): ${ethers.formatEther(totalCost)}`);

        const doubled = totalCost * 2n;
        console.log(`Doubled (Fund Amount): ${ethers.formatEther(doubled)}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

// Get the latest batch ID
async function run() {
    const res = await pool.query('SELECT id FROM batches ORDER BY id DESC LIMIT 1');
    if (res.rows.length > 0) {
        await debugGas(res.rows[0].id);
    }
}

run();
