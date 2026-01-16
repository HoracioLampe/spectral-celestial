
const { Pool } = require('pg');
const { ethers } = require('ethers');
const RelayerEngine = require('../services/relayerEngine');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function runBatch() {
    // Get batch from args
    const batchArgIndex = process.argv.indexOf('--batch');
    let batchId = null;
    if (batchArgIndex !== -1 && process.argv[batchArgIndex + 1]) {
        batchId = parseInt(process.argv[batchArgIndex + 1]);
    }

    if (!batchId) {
        // Find latest batch that is READY and has 0 completed transactions
        const lastBatchRes = await pool.query(`
            SELECT b.id FROM batches b 
            WHERE b.status = 'READY' 
            AND (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = b.id AND status = 'COMPLETED') = 0
            ORDER BY b.id ASC LIMIT 1
        `);
        if (lastBatchRes.rows.length === 0) {
            console.error("❌ No ready batches with 0 completions found.");
            await pool.end();
            return;
        }
        batchId = lastBatchRes.rows[0].id;
    }

    console.log(`🚀 INICIANDO BATCH #${batchId}...`);

    try {
        const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
        const faucetKey = faucetRes.rows[0]?.private_key;
        if (!faucetKey) throw new Error("No Faucet Private Key found in DB.");

        const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

        // 1. Prepare Relayers (Create them if they don't exist for this batch)
        const relayerCount = 20;
        console.log(`🏗️  Preparando ${relayerCount} relayers...`);
        await engine.prepareRelayers(batchId, relayerCount);

        // 2. Start Execution
        const relayersRes = await pool.query('SELECT private_key FROM relayers WHERE batch_id = $1', [batchId]);
        const relayers = relayersRes.rows.map(r => new ethers.Wallet(r.private_key, engine.provider));

        console.log(`🔥 Lanzando ejecución para Batch ${batchId}...`);
        await engine.backgroundProcess(batchId, relayers, false);

        console.log(`\n✅ Batch ${batchId} finalizado.`);

    } catch (err) {
        console.error("❌ Error en ejecución:", err);
    } finally {
        await pool.end();
    }
}

runBatch();
