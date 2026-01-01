const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function checkBalances() {
    try {
        console.log("🔍 Checking Balances for Batch 227...");

        // Check Faucet
        const faucetRes = await pool.query('SELECT address FROM faucets ORDER BY id DESC LIMIT 1');
        if (faucetRes.rows.length > 0) {
            const faucetAddr = faucetRes.rows[0].address;
            const bal = await provider.getBalance(faucetAddr);
            const pendingNonce = await provider.getTransactionCount(faucetAddr, 'pending');
            const latestNonce = await provider.getTransactionCount(faucetAddr, 'latest');
            console.log(`🚰 Faucet: ${faucetAddr} | Balance: ${ethers.formatEther(bal)} MATIC | Nonce: L:${latestNonce} P:${pendingNonce} (Diff: ${pendingNonce - latestNonce})`);
        }

        // Check Relayers
        const relayersRes = await pool.query('SELECT address, id FROM relayers WHERE batch_id = $1', [227]);
        console.log(`👷 Found ${relayersRes.rows.length} relayers.`);

        for (const r of relayersRes.rows) {
            const bal = await provider.getBalance(r.address);
            const pendingNonce = await provider.getTransactionCount(r.address, 'pending');
            const latestNonce = await provider.getTransactionCount(r.address, 'latest');
            console.log(`   > Relayer ${r.address.substring(0, 6)}...: ${ethers.formatEther(bal)} MATIC | Nonce: L:${latestNonce} P:${pendingNonce} (Diff: ${pendingNonce - latestNonce})`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkBalances();
