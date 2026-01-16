const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugBatches() {
    console.log("Connecting...");
    const client = await pool.connect();
    try {
        console.log("Querying batches...");
        const res = await client.query(`SELECT id, funder_address, status FROM batches LIMIT 5`);
        console.log("Rows:", JSON.stringify(res.rows, null, 2));

        const count = await client.query('SELECT count(*) FROM batches');
        console.log("Total Count:", count.rows[0].count);
    } catch (e) {
        console.error("DB Error:", e);
    } finally {
        client.release();
        pool.end();
    }
}

debugBatches();
