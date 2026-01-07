
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const targetWallet = process.argv[2];

if (!targetWallet) {
    console.error("Please provide a wallet address as argument");
    process.exit(1);
}

const address = targetWallet.toLowerCase().trim();

async function check() {
    console.log(`🔍 Searching for ${address} in system...\n`);

    try {
        // 1. Check Users (RBAC)
        const userRes = await pool.query('SELECT * FROM rbac_users WHERE lower(address) = $1', [address]);
        if (userRes.rows.length > 0) {
            console.log(`✅ FOUND in 'rbac_users' (Role: ${userRes.rows[0].role})`);
        } else {
            console.log(`❌ NOT FOUND in 'rbac_users'`);
        }

        // 2. Check Faucets (Owners)
        const faucetOwnerRes = await pool.query('SELECT * FROM faucets WHERE lower(funder_address) = $1', [address]);
        if (faucetOwnerRes.rows.length > 0) {
            console.log(`✅ FOUND in 'faucets' (As Funder). Has specific faucet: ${faucetOwnerRes.rows[0].address}`);
        } else {
            console.log(`❌ NOT FOUND in 'faucets' (As Funder)`);
        }

        // 2b. Check Faucets (The faucet itself)
        const faucetRes = await pool.query('SELECT * FROM faucets WHERE lower(address) = $1', [address]);
        if (faucetRes.rows.length > 0) {
            console.log(`✅ FOUND in 'faucets' (Is a Faucet Wallet). Owner: ${faucetRes.rows[0].funder_address}`);
        }

        // 3. Check Relayers
        const relayerRes = await pool.query('SELECT * FROM relayers WHERE lower(address) = $1', [address]);
        if (relayerRes.rows.length > 0) {
            console.log(`✅ FOUND in 'relayers' (Is a Relayer). ID: ${relayerRes.rows[0].id}`);
        } else {
            console.log(`❌ NOT FOUND in 'relayers'`);
        }

        // 4. Check Batches (As Funder)
        const batchRes = await pool.query('SELECT COUNT(*) FROM batches WHERE lower(funder_address) = $1', [address]);
        if (parseInt(batchRes.rows[0].count) > 0) {
            console.log(`✅ FOUND in 'batches' (Has created ${batchRes.rows[0].count} batches)`);
        }

        // 5. Check Transactions (As Recipient)
        const txRes = await pool.query('SELECT COUNT(*) FROM batch_transactions WHERE lower(wallet_address_to) = $1', [address]);
        if (parseInt(txRes.rows[0].count) > 0) {
            console.log(`✅ FOUND in 'batch_transactions' (Recipient in ${txRes.rows[0].count} txs)`);
        }

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await pool.end();
    }
}

check();
