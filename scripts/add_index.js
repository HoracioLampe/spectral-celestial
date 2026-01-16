require('dotenv').config();
const { Pool } = require('pg');

async function run() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log("Creating index...");
        await pool.query("CREATE INDEX IF NOT EXISTS idx_relayers_last_balance ON relayers(last_balance)");
        console.log("Index created successfully.");
    } catch (e) {
        console.error("Index creation failed:", e);
    } finally {
        await pool.end();
    }
}
run();
