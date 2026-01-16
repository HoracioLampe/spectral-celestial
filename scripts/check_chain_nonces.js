require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function checkNonces() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const batchId = process.argv[2];
    if (!batchId) {
        console.error("Usage: node check_chain_nonces.js <batchId>");
        await pool.end();
        return;
    }

    console.log(`\n🔍 CHECKING ON-CHAIN NONCES FOR BATCH ${batchId}`);

    const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL || "https://polygon-rpc.com");

    try {
        const res = await pool.query('SELECT address FROM relayers WHERE batch_id = $1', [batchId]);
        const relayers = res.rows;
        console.log(`Found ${relayers.length} relayers for batch ${batchId}. Scanning...`);

        let stuckCount = 0;

        for (const r of relayers) {
            const latest = await provider.getTransactionCount(r.address, "latest");
            const pending = await provider.getTransactionCount(r.address, "pending");

            if (pending > latest) {
                console.log(`⚠️  STUCK NONCE DETECTED: ${r.address} | Latest: ${latest} | Pending: ${pending} (Diff: ${pending - latest})`);
                stuckCount++;
            } else {
                // Optional: print clean ones only if verbose, otherwise silent to reduce noise
                // console.log(`✅ ${r.address}: ${latest}`); 
            }
        }

        console.log('\n---------------------------------------------------');
        if (stuckCount === 0) {
            console.log(`✅ ALL CLEAN. No stuck nonces detected in ${relayers.length} relayers.`);
        } else {
            console.log(`❌ FOUND ${stuckCount} relayers with stuck/pending transactions.`);
        }
        console.log('---------------------------------------------------');

    } catch (err) {
        console.error("Critical Error:", err);
    } finally {
        await pool.end();
    }
}

checkNonces();
