
const { Pool } = require('pg');
const { ethers } = require('ethers');
const path = require('path');
const RelayerEngine = require('../services/relayerEngine');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const BATCH_ID = process.argv[2] || 170;

async function resume() {
    console.log(`🚀 RESUMIENDO BATCH #${BATCH_ID}...`);

    try {
        // 1. Determine Correct Faucet for Batch Owner
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [BATCH_ID]);
        if (batchRes.rows.length === 0) throw new Error("Batch not found");

        const funderAddress = batchRes.rows[0].funder_address;

        let faucetKey;
        // Try precise match
        const faucetRes = await pool.query('SELECT private_key FROM faucets WHERE LOWER(funder_address) = LOWER($1)', [funderAddress]);
        if (faucetRes.rows.length > 0) {
            faucetKey = faucetRes.rows[0].private_key;
            console.log(`🎯 Usando Faucet Específica para ${funderAddress}`);
        } else {
            // Fallback
            const fallbackRes = await pool.query('SELECT private_key FROM faucets ORDER BY id ASC LIMIT 1');
            faucetKey = fallbackRes.rows[0]?.private_key;
            console.log("⚠️ Usando Faucet Fallback (Global)");
        }

        if (!faucetKey) throw new Error("No Faucet Private Key found in DB.");

        // 2. Instantiate Engine
        const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

        // 3. Fetch Existing Relayers for this batch
        const relayersRes = await pool.query('SELECT private_key FROM relayers WHERE batch_id = $1 AND status = \'active\'', [BATCH_ID]);
        if (relayersRes.rows.length === 0) {
            console.log("⚠️ No hay relayers activos para este batch. Re-intentando con TODOS los del batch...");
            const allRelayersRes = await pool.query('SELECT private_key FROM relayers WHERE batch_id = $1', [BATCH_ID]);
            if (allRelayersRes.rows.length === 0) throw new Error("No hay relayers registrados para este batch.");
            relayersRes.rows = allRelayersRes.rows;
        }

        const relayers = relayersRes.rows.map(r => new ethers.Wallet(r.private_key, engine.provider));
        console.log(`👷 Re-activando ${relayers.length} relayers.`);

        // 4. Launch Swarm (Async heartbeat)
        console.log("🔥 Lanzando proceso de ejecución...");
        // Use backgroundProcess but without re-funding if possible. 
        // Actually backgroundProcess handles funding if needed.
        await engine.backgroundProcess(BATCH_ID, relayers, true);

        console.log("\n✅ Batch en marcha nuevamente.");

    } catch (err) {
        console.error("❌ Fallo al resumir:", err);
    } finally {
        await pool.end();
    }
}

resume();
