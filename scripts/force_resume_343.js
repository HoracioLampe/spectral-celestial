
const { Pool } = require('pg');
const dotenv = require('dotenv');
const RelayerEngine = require('../services/relayerEngine');
const rpcManager = require('../services/rpcManager');
const vault = require('../services/vault');

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resumeBatch() {
    console.log("🚀 [Resume] Forcing worker swarm for Batch 343...");

    try {
        const batchId = 343;

        // 1. Get Batch Info
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) {
            console.error("❌ Batch 343 not found.");
            return;
        }

        const funderAddress = batchRes.rows[0].funder_address;

        // 2. Fetch Faucet Private Key from Vault (using the same logic as server.js)
        // In this system, 'funder_address' in batches table corresponds to the user's faucet key in Vault
        const faucetPk = await vault.getRelayerKey(funderAddress);
        if (!faucetPk) {
            throw new Error(`Could not find Faucet Private Key in Vault for ${funderAddress}`);
        }

        // 3. Initialize Engine
        const engine = new RelayerEngine(pool, rpcManager, faucetPk);

        console.log(`✅ Engine initialized for Faucet: ${funderAddress}`);
        console.log(`🎬 Triggering background execution...`);

        // 4. Start Execution
        // Since the user says setup finished but didn't start, we don't have permitData/rootSignatureData here.
        // But if Merkle Root is already on-chain, startExecution will work.
        // If not, it will throw, which is good for diagnosis.
        const result = await engine.startExecution(batchId);
        console.log("✨ Execution Triggered:", result);

        console.log("\n[Note] The swarm is now running in the background of this process.");
        console.log("Wait a few minutes or run the diagnostic script again to see progress.");

        // Keep process alive for a bit to let background workers start
        await new Promise(r => setTimeout(r, 60000));
        console.log("👋 Resume script finished initial trigger phase.");

    } catch (err) {
        console.error("❌ Resume failed:", err.message);
        if (err.message.includes("Root not registered")) {
            console.log("💡 Suggestion: The Merkle Root hasn't been registered on-chain. The user needs to 'Generate Merkle Tree' and 'Sign' in the UI.");
        }
    } finally {
        await pool.end();
    }
}

resumeBatch();
