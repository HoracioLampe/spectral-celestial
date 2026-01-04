require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function recoverSingleRelayer() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const targetAddress = process.argv[2];
    const targetFaucet = process.argv[3];

    if (!targetAddress || !targetFaucet) {
        console.error("Usage: node recover_single_relayer.js <relayerAddress> <targetFaucet>");
        await pool.end();
        return;
    }

    console.log(`\n🚑 RECOVERING SINGLE RELAYER: ${targetAddress}`);

    // DB Check
    const res = await pool.query('SELECT * FROM relayers WHERE address = $1', [targetAddress]);
    if (res.rows.length === 0) {
        console.error("Relayer not found in DB");
        await pool.end();
        return;
    }
    const relayer = res.rows[0];
    console.log(`DB Status: ${relayer.status}, Last Balance: ${relayer.last_balance}`);

    const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL || "https://polygon-rpc.com");

    try {
        const wallet = new ethers.Wallet(relayer.private_key, provider);
        const balance = await provider.getBalance(wallet.address);
        console.log(`Actual Chain Balance: ${ethers.formatEther(balance)} MATIC`);

        // Aggressive recovery: Check cost
        const gasBuffer = ethers.parseEther("0.02"); // Reduced buffer for single shot

        if (balance > gasBuffer) {
            const valueToSend = balance - gasBuffer;
            console.log(`Sending ${ethers.formatEther(valueToSend)} to ${targetFaucet}...`);

            const tx = await wallet.sendTransaction({
                to: targetFaucet,
                value: valueToSend
            });
            console.log(`🚀 TX Sent: ${tx.hash}`);
            await tx.wait();
            console.log("✅ Confirmed!");

            await pool.query("UPDATE relayers SET status = 'drained', last_balance = '0' WHERE address = $1", [targetAddress]);
        } else {
            console.log("⚠️ Balance too low to recover safely.");
        }

    } catch (err) {
        console.error("❌ Recovery Error:", err);
    } finally {
        await pool.end();
    }
}

recoverSingleRelayer();
