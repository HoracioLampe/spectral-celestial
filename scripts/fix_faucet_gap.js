
require('dotenv').config();
const { Pool } = require('pg');
const ethers = require('ethers');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const rpcUrl = process.env.RPC_URL;
// Use a very aggressive gas price multiplier to ensure replacement
const REPLACEMENT_MULTIPLIER = 200n; // 2x existing price approx (or just hardcode massive gas)

async function main() {
    try {
        console.log("🚑 STARTING FAUCET EMERGENCY FIX...");

        // 1. Fetch the specific faucet (from previous diagnosis)
        const targetAddress = "0xB4C367834e3Ea0B85dbC50846A9A6A3c40DFb259";

        const res = await pool.query('SELECT private_key FROM faucets WHERE address = $1', [targetAddress]);
        if (res.rows.length === 0) throw new Error("Faucet not found in DB");

        const pk = res.rows[0].private_key;
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(pk, provider);

        console.log(`Target: ${wallet.address}`);

        // 2. Get State
        const nonce = await provider.getTransactionCount(wallet.address, 'latest');
        console.log(`Next Valid Nonce (Chain): ${nonce}`);

        // 3. Send 0-Value Replacement for the stuck nonce (which is equal to 'nonce' based on diagnosis)
        // If there were a gap, we'd loop. But diagnosis showed Nonce 210 stuck, and Latest was 210. 
        // So we just need to replace nonce 210.

        const feeData = await provider.getFeeData();
        console.log("Current Network Gas:", ethers.formatUnits(feeData.gasPrice, 'gwei'), "gwei");

        // Force very high gas to replace whatever is stuck (800+ gwei was seen)
        // Let's use 1000 Gwei to be safe/aggressive for unblocking. 
        const aggressiveGas = ethers.parseUnits('1500', 'gwei');

        console.log(`🚀 Sending Replacement Tx with Nonce ${nonce} @ 1500 Gwei...`);

        const tx = await wallet.sendTransaction({
            to: wallet.address, // Self-send
            value: 0,
            nonce: nonce,
            gasPrice: aggressiveGas,
            gasLimit: 21000
        });

        console.log(`✅ Replacement Sent! Hash: ${tx.hash}`);
        console.log("⏳ Waiting for confirmation...");

        await tx.wait(1);
        console.log("🎉 Transaction Confirmed! Faucet should be unblocked.");

    } catch (e) {
        console.error("❌ Fix Failed:", e);
    } finally {
        pool.end();
    }
}

main();
