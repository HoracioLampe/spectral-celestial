const { ethers } = require('ethers');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function check() {
    try {
        const faucetRes = await pool.query('SELECT address FROM faucets ORDER BY id DESC LIMIT 1');
        let faucetAddr = process.env.FAUCET_ADDRESS; // If they have one in env

        if (faucetRes.rows.length > 0) {
            faucetAddr = faucetRes.rows[0].address;
            console.log(`🏦 Faucet from DB: ${faucetAddr}`);
        } else {
            console.log("ℹ️ No faucet in DB.");
        }

        if (faucetAddr) {
            const bal = await provider.getBalance(faucetAddr);
            console.log(`💰 Balance: ${ethers.formatEther(bal)} MATIC`);
        }

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await pool.end();
    }
}

check();
