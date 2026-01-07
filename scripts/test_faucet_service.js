
const { Pool } = require('pg');
const { ethers } = require('ethers');
const faucetService = require('../services/faucet');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");

async function testFaucet() {
    console.log("🧪 Testing Faucet Service with Explicit Funder...");

    const testFunder = 'TEST_USER_VALIDATION_' + Date.now();

    try {
        console.log(`1. Requesting wallet for ${testFunder} (Should Create New)`);
        const wallet1 = await faucetService.getFaucetWallet(pool, provider, testFunder);
        console.log(`✅ Wallet 1: ${wallet1.address}`);

        console.log(`2. Requesting wallet for ${testFunder} (Should Retrieve Existing)`);
        const wallet2 = await faucetService.getFaucetWallet(pool, provider, testFunder);
        console.log(`✅ Wallet 2: ${wallet2.address}`);

        if (wallet1.address === wallet2.address) {
            console.log("✅ SUCCESS: Addresses match!");
        } else {
            console.error("❌ FAILURE: Addresses do not match!");
        }

    } catch (err) {
        console.error("❌ Test Failed:", err);
    } finally {
        await pool.end();
    }
}

testFaucet();
