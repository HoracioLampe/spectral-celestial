
const { Pool } = require('pg');
const { ethers } = require('ethers');
const path = require('path');
const RelayerEngine = require('../services/relayerEngine');
const RpcManager = require('../services/rpcManager');
const vault = require('../services/vault');
const faucetService = require('../services/faucet');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// RPC Configuration (Failover) - Consistent with server.js
const RPC_PRIMARY = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const RPC_FALLBACK = process.env.RPC_FALLBACK_URL || "https://fluent-clean-orb.matic.quiknode.pro/d95e5af7a69e7b5f8c09a440a5985865d6f4ae93/";

const globalRpcManager = new RpcManager(RPC_PRIMARY, RPC_FALLBACK);
const BATCH_ID = process.argv[2] || 170;

async function resume() {
    console.log(`🚀 RESUMIENDO BATCH #${BATCH_ID}...`);

    try {
        // 1. Determine Correct Faucet for Batch Owner
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [BATCH_ID]);
        if (batchRes.rows.length === 0) throw new Error("Batch not found");

        const funderAddress = batchRes.rows[0].funder_address;

        // Use faucetService to get a properly connected faucet wallet
        const faucetWallet = await faucetService.getFaucetWallet(pool, globalRpcManager.getProvider(), funderAddress);

        if (!faucetWallet) throw new Error("No Faucet Wallet found/generated.");
        console.log(`🎯 Usando Faucet: ${faucetWallet.address} para ${funderAddress}`);

        // 2. Instantiate Engine with RpcManager
        console.log(`🔌 Engine inicializado con RPC Principal: ${RPC_PRIMARY.substring(0, 20)}...`);
        const engine = new RelayerEngine(pool, globalRpcManager, faucetWallet.privateKey);

        // 3. Fetch Existing Relayers for this batch
        const relayersRes = await pool.query('SELECT address FROM relayers WHERE batch_id = $1 AND status = \'active\'', [BATCH_ID]);
        if (relayersRes.rows.length === 0) {
            console.log("⚠️ No hay relayers activos para este batch. Re-intentando con TODOS los del batch...");
            const allRelayersRes = await pool.query('SELECT address FROM relayers WHERE batch_id = $1', [BATCH_ID]);
            if (allRelayersRes.rows.length === 0) throw new Error("No hay relayers registrados para este batch.");
            relayersRes.rows = allRelayersRes.rows;
        }

        const relayers = [];
        for (const row of relayersRes.rows) {
            const pk = await vault.getRelayerKey(row.address);
            if (pk) {
                relayers.push(new ethers.Wallet(pk, engine.provider));
            } else {
                console.warn(`⚠️ Relayer ${row.address} not found in Vault. Skipping.`);
            }
        }

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
