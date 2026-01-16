
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function audit() {
    console.log("🕵️‍♂️ Starting Security Audit of Faucets...");

    try {
        // 1. Dump ALL Faucets
        const res = await pool.query('SELECT * FROM faucets ORDER BY id DESC');
        console.log(`\n📋 Found ${res.rows.length} registered faucets:`);
        console.table(res.rows.map(f => ({
            id: f.id,
            address: f.address,
            funder: f.funder_address,
            // created_at: f.created_at // if exists
        })));

        // 2. Check for suspicious similar addresses (fuzzy match?)
        // Just purely visual for now via the table.

        // 3. Check Batches that might have triggered this
        // If the script ran recently, let's look at the 'updated_at' of batches
        const batchRes = await pool.query('SELECT id, funder_address, status, updated_at FROM batches ORDER BY updated_at DESC LIMIT 10');
        console.log("\nRecent Batch Activity:");
        console.table(batchRes.rows);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

audit();
