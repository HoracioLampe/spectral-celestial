require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkBatchStatus() {
    try {
        // Check Batch 325 status
        const batchRes = await pool.query(`
            SELECT id, status, total_transactions, funder_address, merkle_root
            FROM batches
            WHERE id = 325
        `);

        if (batchRes.rows.length === 0) {
            console.log("❌ Batch 325 not found");
            return;
        }

        const batch = batchRes.rows[0];
        console.log("\n📦 Batch 325 Status:");
        console.log(`   Status: ${batch.status}`);
        console.log(`   Total Transactions: ${batch.total_transactions}`);
        console.log(`   Funder: ${batch.funder_address}`);
        console.log(`   Merkle Root: ${batch.merkle_root ? 'Set' : 'NOT SET'}`);

        // Check relayers for this batch
        const relayersRes = await pool.query(`
            SELECT address, last_balance, status
            FROM relayers
            WHERE batch_id = 325
            ORDER BY id
        `);

        console.log(`\n👥 Relayers: ${relayersRes.rows.length}`);
        if (relayersRes.rows.length > 0) {
            relayersRes.rows.forEach((r, i) => {
                console.log(`   ${i + 1}. ${r.address} - Balance: ${r.last_balance || '0'} MATIC - Status: ${r.status || 'N/A'}`);
            });
        } else {
            console.log("   ⚠️  No relayers found for Batch 325!");
        }

        // Check transaction status breakdown
        const txStatusRes = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM batch_transactions
            WHERE batch_id = 325
            GROUP BY status
            ORDER BY count DESC
        `);

        console.log(`\n📊 Transaction Status:`);
        txStatusRes.rows.forEach(row => {
            console.log(`   ${row.status}: ${row.count}`);
        });

        // Check if there are active workers
        const activeRes = await pool.query(`
            SELECT COUNT(*) as count
            FROM batch_transactions
            WHERE batch_id = 325
            AND status = 'ENVIANDO'
        `);

        console.log(`\n🔄 Active Processing:`);
        console.log(`   ENVIANDO (in-flight): ${activeRes.rows[0].count}`);

        if (activeRes.rows[0].count === 0 && txStatusRes.rows.some(r => r.status === 'PENDING')) {
            console.log(`\n⚠️  WARNING: Batch has PENDING transactions but no active workers!`);
            console.log(`   The batch processing has STOPPED.`);
            console.log(`   You need to restart the batch execution.`);
        }

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await pool.end();
    }
}

checkBatchStatus();
