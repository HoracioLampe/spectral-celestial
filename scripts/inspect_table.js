
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkColumns() {
    const client = await pool.connect();
    try {
        console.log("🔍 Inspecting 'batch_transactions' columns...");

        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'batch_transactions'
        `);

        console.table(res.rows);
    } catch (e) {
        console.error("❌ Inspection Failed:", e.message);
    } finally {
        client.release();
        pool.end();
    }
}

checkColumns();
