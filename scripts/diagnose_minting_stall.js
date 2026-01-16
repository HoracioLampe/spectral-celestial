
const { Pool } = require('pg');
const dotenv = require('dotenv');
const ethers = require('ethers');

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function diagnose() {
    console.log("🔍 [Diagnostic] Checking Batch Status and Queue...");

    try {
        // 1. Get the latest batch
        const batchRes = await pool.query('SELECT * FROM batches ORDER BY id DESC LIMIT 1');
        const batch = batchRes.rows[0];

        if (!batch) {
            console.log("❌ No batches found.");
            return;
        }

        console.log(`\n📦 Batch ID: ${batch.id}`);
        console.log(`   Status: ${batch.status}`);
        console.log(`   Merkle Root: ${batch.merkle_root}`);
        console.log(`   Transactions (Total): ${batch.total_transactions}`);

        // 2. Count transactions by status
        const txStatsRes = await pool.query(`
            SELECT status, count(*) 
            FROM batch_transactions 
            WHERE batch_id = $1 
            GROUP BY status
        `, [batch.id]);

        console.log("\n📊 Transaction Queue Status:");
        if (txStatsRes.rows.length === 0) {
            console.log("   (Empty queue)");
        } else {
            txStatsRes.rows.forEach(row => {
                console.log(`   - ${row.status}: ${row.count}`);
            });
        }

        // 3. Check Relayers for this batch
        const relayerRes = await pool.query(`
            SELECT address, status, last_balance, vault_status, gas_cost
            FROM relayers 
            WHERE batch_id = $1
        `, [batch.id]);

        console.log("\n👷 Relayer Status (Top 5):");
        if (relayerRes.rows.length === 0) {
            console.log("   (No relayers found)");
        } else {
            relayerRes.rows.slice(0, 5).forEach(r => {
                console.log(`   - ${r.address}: Status=${r.status}, Balance=${r.last_balance}, Vault=${r.vault_status}, Gas=${r.gas_cost}`);
            });
            console.log(`   ... total ${relayerRes.rows.length} relayers.`);
        }

        // 4. Check if any transactions are in 'ENVIANDO' but not COMPLETED (Stuck?)
        const sendingRes = await pool.query(`
            SELECT id, relayer_address, updated_at 
            FROM batch_transactions 
            WHERE batch_id = $1 AND status = 'ENVIANDO'
            LIMIT 5
        `, [batch.id]);

        if (sendingRes.rows.length > 0) {
            console.log("\n⚠️ [Warning] Found transactions in 'ENVIANDO' status:");
            sendingRes.rows.forEach(tx => {
                console.log(`   - Tx ${tx.id} locked by ${tx.relayer_address} since ${tx.updated_at}`);
            });
        }

    } catch (err) {
        console.error("❌ Diagnostic failed:", err.message);
    } finally {
        await pool.end();
    }
}

diagnose();
