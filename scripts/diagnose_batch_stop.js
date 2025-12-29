
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const BATCH_ID = 188; // Hardcoded based on previous context

async function diagnose() {
    try {
        console.log(`--- Diagnosing Batch ${BATCH_ID} Stoppage ---`);

        // 1. Check Last Transaction Activity
        const lastTxRes = await pool.query(`
            SELECT id, status, updated_at 
            FROM batch_transactions 
            WHERE batch_id = $1 AND status != 'PENDING'
            ORDER BY updated_at DESC LIMIT 5
        `, [BATCH_ID]);

        if (lastTxRes.rows.length === 0) {
            console.log("No transactions have been processed yet.");
        } else {
            console.log("Last 5 Processed Transactions:");
            lastTxRes.rows.forEach(r => {
                console.log(`- ID: ${r.id}, Status: ${r.status}, Time: ${r.updated_at}`);
            });

            const lastTime = new Date(lastTxRes.rows[0].updated_at);
            const now = new Date();
            const diffMinutes = (now - lastTime) / 1000 / 60;
            console.log(`\nTime since last activity: ${diffMinutes.toFixed(2)} minutes`);
        }

        // 2. Check Relayer Status & Balances
        console.log("\n--- Relayer Status ---");
        const relayerRes = await pool.query(`
            SELECT *
            FROM relayers 
            WHERE batch_id = $1
        `, [BATCH_ID]);

        relayerRes.rows.forEach(r => {
            console.log(`Relayer ${r.id} (${r.address.substring(0, 6)}...): Balance=${r.last_balance}, TxHashDeposit=${r.transactionhash_deposit}`);
        });

        // 3. Check for Errors
        const errorRes = await pool.query(`
            SELECT count(*) 
            FROM batch_transactions 
            WHERE batch_id = $1 AND status = 'FAILED'
        `, [BATCH_ID]);
        console.log(`\nTotal Failed Transactions: ${errorRes.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

diagnose();
