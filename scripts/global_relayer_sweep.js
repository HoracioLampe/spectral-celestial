require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = process.env.RPC_URL;
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function sweep() {
    try {
        console.log("🔍 Global Sweep: Finding all relayers with > 0.05 MATIC...");

        // Join with batches and faucets to get the CORRECT return address for each relayer
        const query = `
        SELECT r.address, r.private_key, r.last_balance, b.id as batch_id, f.address as faucet_address
        FROM relayers r
        JOIN batches b ON r.batch_id = b.id
        JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
        WHERE CAST(r.last_balance AS NUMERIC) > 0.05
    `;

        const res = await pool.query(query);
        const relayers = res.rows;
        console.log(`📦 Found ${relayers.length} relayers to sweep.`);

        const feeData = await provider.getFeeData();
        const gasPrice = (feeData.gasPrice * 300n) / 100n; // 3x Aggressive
        const gasLimit = 21000n;
        const minCost = gasPrice * gasLimit;

        for (const r of relayers) {
            if (!r.faucet_address) {
                console.log(`⚠️ No Faucet found for Relayer ${r.address} (Batch ${r.batch_id}). Skipping.`);
                continue;
            }

            try {
                const wallet = new ethers.Wallet(r.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                if (balance > minCost) {
                    const amountToSend = balance - minCost;

                    // Double check it's worth sending (e.g. > 0.01)
                    if (amountToSend < ethers.parseEther("0.01")) continue;

                    // NUCLEAR SWEEP: Force nonce to 'latest' to replace any stuck txs at the head of the line.
                    // This drains the wallet, making subsequent [pending] nonces invalid (lack of funds).

                    const available = balance;
                    const finalAmountToSend = available - minCost;

                    if (finalAmountToSend < ethers.parseEther("0.01")) continue;

                    console.log(`   💸 Sweeping ${ethers.formatEther(finalAmountToSend)} MATIC...`);

                    // Aggressive Gas for Replacement (2.0x of calculated aggressive)
                    const replacementGasPrice = gasPrice * 2n;

                    try {
                        const tx = await wallet.sendTransaction({
                            to: r.faucet_address,
                            value: finalAmountToSend,
                            gasPrice: replacementGasPrice,
                            gasLimit: gasLimit,
                            nonce: await provider.getTransactionCount(r.address, 'latest') // FORCE LATEST
                        });
                        console.log(`   ✅ Sweep Sent: ${tx.hash}`);
                        await tx.wait(); // Wait for the transaction to be mined

                        await pool.query("UPDATE relayers SET status = 'drained', last_balance = '0' WHERE address = $1", [r.address]);
                    } catch (txErr) {
                        if (txErr.message.includes("replacement transaction underpriced")) {
                            console.log("   ⚠️  Replacement underpriced. Skipping for now.");
                        } else {
                            console.error(`   ❌ Error sweeping: ${txErr.message}`);
                        }
                    }
                }
            } catch (e) {
                console.error(`   ❌ Error verifying/sweeping ${r.address}:`, e.message);
            }
        }

    } catch (err) {
        console.error('Fatal:', err);
    } finally {
        await pool.end();
    }
}

sweep();
