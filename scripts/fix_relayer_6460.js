require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function fixRelayer() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const targetId = 6460;
    const targetAddress = '0xF698DBb31bf8EdD84B9346AA2Fc738F59607f6b2';

    console.log(`\n🔧 DIAGNOSING RELAYER ${targetId} (${targetAddress})`);

    // 1. Check DB Status
    const res = await pool.query('SELECT status, last_balance FROM relayers WHERE id = $1', [targetId]);
    if (res.rows.length === 0) {
        console.log("❌ Relayer not found in DB.");
        await pool.end();
        return;
    }
    console.log(`DB Status: [${res.rows[0].status}] | Last Balance: ${res.rows[0].last_balance}`);

    // 2. Check On-Chain Balance
    const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL || "https://polygon-rpc.com");
    try {
        const balance = await provider.getBalance(targetAddress);
        const balanceMatic = ethers.formatEther(balance);
        console.log(`On-Chain Balance: ${balanceMatic} MATIC`);

        if (parseFloat(balanceMatic) < 0.1) {
            console.log("✅ Balance is low (Drained). Fixing DB status...");
            await pool.query("UPDATE relayers SET status = 'drained', last_balance = '0' WHERE id = $1", [targetId]);
            console.log("✅ DB Updated to 'drained'.");
        } else {
            console.log("⚠️ Balance is still high! Recovery might have failed or pending.");
        }

    } catch (err) {
        console.error("Error checking chain:", err);
    } finally {
        await pool.end();
    }
}

fixRelayer();
