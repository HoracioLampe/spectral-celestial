
const { Pool } = require('pg');
const ethers = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function auditFunds() {
    try {
        console.log("🔍 Auditing Stuck Relayer Funds...");

        // Count relayers with balance > 0.1 MATIC (worth recovering)
        const res = await pool.query(`
            SELECT count(*) as count, sum(cast(last_balance as numeric)) as total 
            FROM relayers 
            WHERE cast(last_balance as numeric) > 0.05
        `);

        const { count, total } = res.rows[0];
        console.log(`📉 Found ${count} relayers with significant funds (> 0.05 MATIC).`);
        console.log(`💰 Total Potential Recovery: ${total} MATIC`);

        const sample = await pool.query(`
            SELECT address, last_balance 
            FROM relayers 
            WHERE cast(last_balance as numeric) > 1.0 
            LIMIT 5
        `);
        if (sample.rows.length > 0) {
            console.log("Samples (> 1 MATIC):", sample.rows);
        }

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

auditFunds();
