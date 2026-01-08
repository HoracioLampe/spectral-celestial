
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log("--- Executing: SELECT * FROM relayers WHERE batch_id = 342 ---");
        const res = await pool.query('SELECT * FROM relayers WHERE batch_id = 342');
        console.log(`Results found: ${res.rows.length}`);
        if (res.rows.length > 0) {
            console.table(res.rows);
        } else {
            console.log("Empty result set (0 rows).");
        }

        // Just as a double check, let's look for the 5 most recent across all batches
        console.log("\n--- Executing: SELECT id, address, batch_id FROM relayers ORDER BY id DESC LIMIT 5 ---");
        const res2 = await pool.query('SELECT id, address, batch_id FROM relayers ORDER BY id DESC LIMIT 5');
        console.table(res2.rows);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

run();
