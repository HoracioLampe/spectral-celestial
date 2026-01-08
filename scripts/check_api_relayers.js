
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const ethers = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");

async function testApi() {
    try {
        console.log("Searching for ANY relayer with balance exactly 20.0 in DB...");
        // Handle both STRING and NUMERIC representations if applicable
        const res = await pool.query('SELECT address, batch_id, last_balance, status FROM relayers WHERE last_balance = $1 OR last_balance = $2', ['20.0', '20']);
        console.log(`Results: ${res.rows.length}`);
        res.rows.forEach(r => console.log(` - ${r.address} | Batch: ${r.batch_id} | Status: ${r.status}`));

        console.log("\nSearching for most recent relayers without batch ID...");
        const res2 = await pool.query('SELECT * FROM relayers WHERE batch_id IS NULL ORDER BY id DESC LIMIT 5');
        console.log(`Results: ${res2.rows.length}`);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

testApi();
