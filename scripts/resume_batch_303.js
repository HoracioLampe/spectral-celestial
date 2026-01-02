require('dotenv').config();
const { Pool } = require('pg');
const RelayerEngine = require('../services/relayerEngine');

async function resumeBatch303() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const batchId = 303;

        console.log(`=== Resuming Batch ${batchId} ===\n`);

        // Get batch info
        const batchRes = await pool.query('SELECT * FROM batches WHERE id = $1', [batchId]);
        const batch = batchRes.rows[0];

        console.log(`Status: ${batch.status}`);
        console.log(`Total Transactions: ${batch.total_transactions}`);
        console.log(`Merkle Root: ${batch.merkle_root}\n`);

        // Get relayers
        const relayersRes = await pool.query(`
            SELECT address, private_key, status 
            FROM relayers 
            WHERE batch_id = $1 AND status = 'active'
            ORDER BY id ASC
        `, [batchId]);

        const relayers = relayersRes.rows;
        console.log(`Found ${relayers.length} active relayers\n`);

        if (relayers.length === 0) {
            console.log('❌ No active relayers found. Cannot resume.');
            return;
        }

        // Initialize RelayerEngine
        const engine = new RelayerEngine(pool);

        console.log('🔄 Starting batch resumption...\n');
        console.log('⚠️  This will use QUICKNODE RPC to avoid Chainstack rate limits\n');

        // Resume execution (isResumption = true, no permit/signature needed)
        await engine.startExecution(
            batchId,
            relayers,
            true,  // isResumption = true
            null,  // no permit needed
            null   // no root signature needed
        );

        console.log('\n✅ Batch resumption initiated!');
        console.log('Monitor progress in Railway logs or the UI');

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err.stack);
    } finally {
        await pool.end();
        // Don't exit immediately, let background process run
        console.log('\n⏳ Background process running... Press Ctrl+C to exit when done.');
    }
}

resumeBatch303();
