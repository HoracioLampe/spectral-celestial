require('dotenv').config();
const { Pool } = require('pg');

async function identifyFaucet() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const batchId = process.argv[2];
    if (!batchId) {
        console.error("Please provide a batch ID");
        await pool.end();
        return;
    }

    console.log(`Identifying Target Faucet for Batch ID: ${batchId}`);
    try {
        // 1. Get Batch Funder
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) {
            console.log("❌ Batch NOT FOUND");
            await pool.end();
            return;
        }
        const funderAddress = batchRes.rows[0].funder_address;
        console.log(`Batch Funder Address: ${funderAddress}`);

        if (!funderAddress) {
            console.log("❌ Batch has no funder_address set.");
            await pool.end();
            return;
        }

        // 2. Find Faucet for this Funder
        const faucetRes = await pool.query('SELECT address FROM faucets WHERE LOWER(funder_address) = LOWER($1)', [funderAddress]);

        if (faucetRes.rows.length === 0) {
            console.log(`❌ No Faucet found linked to funder ${funderAddress}`);
            // Check if there is a 'default' faucet or if the funder IS the faucet (unlikely in this schema but possible in logic)
        } else {
            console.log(`✅ Target Faucet Found: ${faucetRes.rows[0].address}`);
        }

    } catch (err) {
        console.error("Error executing query:", err);
    }
    await pool.end();
}

identifyFaucet();
