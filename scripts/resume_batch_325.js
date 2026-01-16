require('dotenv').config();
const { Pool } = require('pg');
const RelayerEngine = require('../services/relayerEngine');
const RpcManager = require('../services/rpcManager');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RPC_PRIMARY = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const RPC_FALLBACK = process.env.RPC_FALLBACK_URL || "https://fluent-clean-orb.matic.quiknode.pro/d95e5af7a69e7b5f8c09a440a5985865d6f4ae93/";

console.log("🔧 RPC Configuration:");
console.log(`   Primary: ${RPC_PRIMARY.substring(0, 40)}...`);
console.log(`   Fallback: ${RPC_FALLBACK.substring(0, 40)}...`);

const rpcManager = new RpcManager(RPC_PRIMARY, RPC_FALLBACK);

async function resumeBatch325() {
    try {
        console.log("\n🚀 Resuming Batch 325 processing...\n");

        // 1. Get batch info
        const batchRes = await pool.query(`SELECT * FROM batches WHERE id = 325`);
        if (batchRes.rows.length === 0) {
            console.log("❌ Batch 325 not found");
            return;
        }
        const batch = batchRes.rows[0];
        console.log(`📦 Batch 325: ${batch.total_transactions} transactions`);
        console.log(`   Funder: ${batch.funder_address}`);

        // 2. Get faucet for this funder
        const faucetRes = await pool.query(
            `SELECT private_key FROM faucets WHERE LOWER(funder_address) = LOWER($1) LIMIT 1`,
            [batch.funder_address]
        );

        if (faucetRes.rows.length === 0) {
            console.log(`❌ No faucet found for funder ${batch.funder_address}`);
            return;
        }

        const faucetPrivateKey = faucetRes.rows[0].private_key;
        console.log(`✅ Faucet found for funder`);

        // 3. Get relayers
        const relayersRes = await pool.query(
            `SELECT address, private_key FROM relayers WHERE batch_id = 325 ORDER BY id`
        );

        if (relayersRes.rows.length === 0) {
            console.log("❌ No relayers found for Batch 325");
            return;
        }

        console.log(`👥 Found ${relayersRes.rows.length} relayers`);

        // 4. Initialize RelayerEngine
        const engine = new RelayerEngine(pool, rpcManager, faucetPrivateKey);

        // 5. Convert relayers to wallet objects
        const { ethers } = require('ethers');
        const relayerWallets = relayersRes.rows.map(r => {
            return new ethers.Wallet(r.private_key, rpcManager.getProvider());
        });

        console.log(`\n🔄 Starting background processing...`);

        // 6. Resume processing (isResumption = true)
        await engine.backgroundProcess(325, relayerWallets, true, null, null);

        console.log(`\n✅ Batch 325 processing completed!`);

    } catch (error) {
        console.error("\n❌ Error:", error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

resumeBatch325();
