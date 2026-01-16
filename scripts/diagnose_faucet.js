
require('dotenv').config();
const { Pool } = require('pg');
const ethers = require('ethers');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const stuckHash = '0x8a954c8c4822426a11562258f4fc686d85b0ecf0cc6f6d554b203bb062d9b46b';
const rpcUrl = process.env.RPC_URL;
const provider = new ethers.JsonRpcProvider(rpcUrl);

async function main() {
    try {
        console.log("🔍 Diagnosing Faucet State...");

        let faucetAddress = null;

        // 1. Try to get address from Tx
        const tx = await provider.getTransaction(stuckHash);
        if (tx) {
            console.log(`✅ Stuck Tx Found in Mempool!`);
            console.log(`   From: ${tx.from}`);
            console.log(`   Nonce: ${tx.nonce}`);
            console.log(`   GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} gwei`);
            faucetAddress = tx.from;
        } else {
            console.log("⚠️ Stuck Tx NOT found in Mempool (Dropped or Confirmed?).");
        }

        // 2. If not found, fetch all faucets from DB and check them
        if (!faucetAddress) {
            console.log("   Fetching faucets from DB...");
            const res = await pool.query('SELECT address, private_key FROM faucets');
            if (res.rows.length === 0) {
                console.error("❌ No faucets found in DB.");
                return;
            }
            console.log(`   Found ${res.rows.length} faucets. Checking all...`);

            for (const row of res.rows) {
                await checkFaucet(row.address, row.private_key);
            }
        } else {
            // Check specific faucet
            const res = await pool.query('SELECT private_key FROM faucets WHERE address = $1', [faucetAddress]);
            const pk = res.rows[0]?.private_key;
            await checkFaucet(faucetAddress, pk);
        }

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        pool.end();
    }
}

async function checkFaucet(address, privateKey) {
    console.log(`\nChecking Faucet: ${address}`);
    try {
        const nonce = await provider.getTransactionCount(address, 'latest');
        const pending = await provider.getTransactionCount(address, 'pending');

        console.log(`   Nonce (Latest): ${nonce}`);
        console.log(`   Nonce (Pending): ${pending}`);

        if (pending > nonce) {
            console.warn(`   ⚠️  GAP DETECTED! Gap Size: ${pending - nonce}`);
            console.log("   ACTION REQUIRED: Sanitize this faucet.");

            // Auto-Sanitize Logic Proposal (Commented out)
            // sendSanitizationTx(address, privateKey, nonce);
        } else {
            console.log("   ✅ Status: Healthy (No gaps)");
        }

    } catch (e) {
        console.error(`   ❌ Failed to check ${address}:`, e.message);
    }
}

main();
