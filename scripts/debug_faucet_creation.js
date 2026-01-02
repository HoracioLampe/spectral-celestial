const { Pool } = require('pg');
const ethers = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const TEST_ADDRESS = "0xTestUser" + Math.floor(Math.random() * 10000); // Random test user

async function debugAuthFlow() {
    try {
        console.log(`Starting Debug for User: ${TEST_ADDRESS}`);
        const normalizedAddress = TEST_ADDRESS.toLowerCase();

        // 1. Simulate RBAC Check/Insert
        try {
            console.log("1. Checking RBAC...");
            const userRes = await pool.query('SELECT role FROM rbac_users WHERE address = $1', [normalizedAddress]);
            let role = 'REGISTERED';
            if (userRes.rows.length > 0) {
                console.log("   User exists in RBAC.");
                role = userRes.rows[0].role;
            } else {
                console.log("   User NOT in RBAC. Inserting...");
                await pool.query('INSERT INTO rbac_users (address, role) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING', [normalizedAddress, role]);
                console.log("   RBAC Inserted.");
            }
        } catch (e) { console.error("RBAC Step Error:", e.message); }

        // 2. Simulate Faucet Check/Insert (The failing part?)
        try {
            console.log("2. Checking Faucet...");
            // Use VERBOSE logging
            const checkQuery = 'SELECT 1 FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1';
            console.log(`   Running: ${checkQuery} with [${normalizedAddress}]`);

            const faucetRes = await pool.query(checkQuery, [normalizedAddress]);

            if (faucetRes.rows.length === 0) {
                console.log(`   [Auth] No Faucet found for ${normalizedAddress}. generating...`);
                const wallet = ethers.Wallet.createRandom();

                const insertQuery = 'INSERT INTO faucets (address, private_key, funder_address) VALUES ($1, $2, $3) RETURNING *';
                console.log(`   Running INSERT... (${wallet.address})`);

                const insertRes = await pool.query(insertQuery, [wallet.address, wallet.privateKey, normalizedAddress]);
                console.log("   ✅ Faucet Created:", insertRes.rows[0]);
            } else {
                console.log("   ✅ Faucet ALREADY EXISTS.");
            }
        } catch (e) {
            console.error("❌ Faucet Creation FAILED:", e);
        }

    } catch (e) {
        console.error("Global Error:", e);
    } finally {
        await pool.end();
    }
}

debugAuthFlow();
