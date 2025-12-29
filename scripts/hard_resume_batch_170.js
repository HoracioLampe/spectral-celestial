
const { Pool } = require('pg');
const { ethers } = require('ethers');
const RelayerEngine = require('../services/relayerEngine');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const BATCH_ID = 170;

async function hardResetAndResume() {
    console.log(`🧹 RESETTING & RESUMING BATCH #${BATCH_ID}...`);

    try {
        // 1. Reset all non-completed txs to PENDING
        const resetRes = await pool.query(
            "UPDATE batch_transactions SET status = 'PENDING', retry_count = 0 WHERE batch_id = $1 AND status != 'COMPLETED'",
            [BATCH_ID]
        );
        console.log(`✅ ${resetRes.rowCount} transacciones reseteadas a PENDING.`);

        // 2. Fetch Faucet
        const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
        const faucetKey = faucetRes.rows[0]?.private_key;

        const engine = new RelayerEngine(pool, RPC_URL, faucetKey);

        // 3. Fetch Relayers
        const relayersRes = await pool.query('SELECT private_key, address FROM relayers WHERE batch_id = $1', [BATCH_ID]);
        const relayers = relayersRes.rows.map(r => new ethers.Wallet(r.private_key, engine.provider));
        console.log(`👷 Reparando nonces para ${relayers.length} relayers...`);

        // 4. Force repair for each relayer (CLEAN STUCK NONCES FIRST)
        console.log(`👷 Reparando nonces para ${relayers.length} relayers...`);
        for (let i = 0; i < relayers.length; i++) {
            const wallet = relayers[i];
            try {
                process.stdout.write(`[${i + 1}/20] ${wallet.address.slice(0, 6)}... `);

                // Use the verifyAndRepairNonce method by temporary swapping faucetWallet
                const originalFaucet = engine.faucetWallet;
                engine.faucetWallet = wallet;
                await engine.verifyAndRepairNonce();
                engine.faucetWallet = originalFaucet;

                console.log("✅");
            } catch (e) {
                console.log(`⚠️ Skip: ${e.message.slice(0, 50)}`);
            }
        }
        console.log("\n✅ Nonces verificados.");

        // 5. Resume
        console.log("🔥 Lanzando Swarm...");
        await engine.backgroundProcess(BATCH_ID, relayers, true);

    } catch (err) {
        console.error("❌ Error CRÍTICO:", err);
    } finally {
        await pool.end();
    }
}

hardResetAndResume();
