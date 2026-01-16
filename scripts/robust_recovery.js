require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

/**
 * ROBUST RECOVERY SCRIPT
 * 1. Checks for stuck nonces (pending > latest)
 * 2. Unblocks stuck nonces with 0 MATIC self-tx (max priority fee)
 * 3. Sweeps remaining funds to the correct Faucet
 */

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = process.env.RPC_URL;
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function unblockAndSweep(relayer, targetFaucet) {
    const wallet = new ethers.Wallet(relayer.private_key, provider);
    const address = wallet.address;

    try {
        console.log(`\n🔍 Processing Relayer: ${address} (Batch ${relayer.batch_id})`);

        // 1. Check Nonce
        const latestNonce = await provider.getTransactionCount(address, 'latest');
        const pendingNonce = await provider.getTransactionCount(address, 'pending');

        console.log(`   - Nonce: Latest=${latestNonce}, Pending=${pendingNonce}`);

        if (pendingNonce > latestNonce) {
            console.log(`   ⚠️ RELAYER STUCK! Unblocking nonces ${latestNonce} to ${pendingNonce - 1}...`);
            const feeData = await provider.getFeeData();
            const aggressiveGasPrice = (feeData.gasPrice * 500n) / 100n; // 5x boost

            for (let n = latestNonce; n < pendingNonce; n++) {
                console.log(`     🚀 Sending unblock self-tx for nonce ${n}...`);
                const tx = await wallet.sendTransaction({
                    to: address,
                    value: 0,
                    nonce: n,
                    gasLimit: 21000,
                    gasPrice: aggressiveGasPrice
                });
                console.log(`     ✅ Unblock tx sent: ${tx.hash}`);
                await tx.wait();
            }
        }

        // 2. Final Sweep
        const balance = await provider.getBalance(address);
        console.log(`   - Final Balance: ${ethers.formatEther(balance)} MATIC`);

        if (balance > ethers.parseEther("0.02")) { // Minimum threshold to sweep
            const feeData = await provider.getFeeData();
            const sweepGasPrice = (feeData.gasPrice * 300n) / 100n; // 3x boost
            const gasLimit = 21000n;
            const cost = sweepGasPrice * gasLimit;

            if (balance > cost) {
                const amountToSend = balance - cost;
                console.log(`   💸 Sweeping ${ethers.formatEther(amountToSend)} MATIC to ${targetFaucet}...`);
                const tx = await wallet.sendTransaction({
                    to: targetFaucet,
                    value: amountToSend,
                    gasLimit: gasLimit,
                    gasPrice: sweepGasPrice
                });
                console.log(`   ✅ Sweep sent: ${tx.hash}`);
                await tx.wait();

                await pool.query(
                    "UPDATE relayers SET status = 'drained', last_balance = '0' WHERE address = $1",
                    [address]
                );
            } else {
                console.log(`   ⚠️ Balance too low to cover cost (${ethers.formatEther(cost)})`);
            }
        } else {
            console.log(`   ℹ️ Dust balance or empty.`);
            await pool.query(
                "UPDATE relayers SET status = 'drained', last_balance = $1 WHERE address = $2",
                [ethers.formatEther(balance), address]
            );
        }
    } catch (err) {
        console.error(`   ❌ Error for ${address}:`, err.message);
    }
}

async function runRecovery() {
    const batchIds = process.argv.slice(2).map(id => parseInt(id));
    if (batchIds.length === 0) {
        console.error("Please provide batch IDs: node robust_recovery.js <batch_id1> <batch_id2> ...");
        process.exit(1);
    }

    try {
        console.log(`🚀 Starting Robust Recovery for Batches: ${batchIds.join(', ')}`);

        // Fetch relayers and their corresponding faucets
        const query = `
            SELECT r.address, r.private_key, r.batch_id, f.address as faucet_address
            FROM relayers r
            JOIN batches b ON r.batch_id = b.id
            JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
            WHERE r.batch_id = ANY($1)
        `;
        const res = await pool.query(query, [batchIds]);
        const relayers = res.rows;

        console.log(`🔍 Found ${relayers.length} relayers.`);

        for (const relayer of relayers) {
            await unblockAndSweep(relayer, relayer.faucet_address);
        }

    } catch (err) {
        console.error("Fatal Error:", err);
    } finally {
        await pool.end();
    }
}

runRecovery();
