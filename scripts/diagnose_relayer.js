const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const TARGET_ADDR = '0xabb5B242Cd3026D23D2D1CD01Ea428D69F848E12';

async function diagnose() {
    try {
        console.log(`🔍 Diagnosing ${TARGET_ADDR}...`);

        // 1. Get Relayer Details
        const res = await pool.query('SELECT * FROM relayers WHERE LOWER(address) = LOWER($1)', [TARGET_ADDR]);
        if (res.rows.length === 0) {
            console.log("❌ Relayer NOT found in DB.");
            return;
        }

        const relayer = res.rows[0];
        console.log("✅ Relayer Found:", relayer);

        // 2. Check Linked Batch
        if (relayer.batch_id) {
            const batchRes = await pool.query('SELECT * FROM batches WHERE id = $1', [relayer.batch_id]);
            const batch = batchRes.rows[0];
            console.log("📦 Linked Batch:", batch);

            // 3. Check rank of batch (is it in last 1000?)
            const rankRes = await pool.query(`
                SELECT count(*) as newer_batches 
                FROM batches 
                WHERE id > $1
            `, [relayer.batch_id]);
            console.log(`📉 Batch is ${rankRes.rows[0].newer_batches} positions old (Limit was 1000).`);
        } else {
            console.log("⚠️ Relayer has NO batch_id (Orphan).");
        }

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

diagnose();
