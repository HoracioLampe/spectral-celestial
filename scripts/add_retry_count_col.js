
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const client = await pool.connect();
        console.log("🔌 Connected to DB");

        console.log("🛠️ Adding retry_count column...");
        await client.query(`
            ALTER TABLE batch_transactions 
            ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
        `);

        console.log("✅ Column added successfully.");
        client.release();
    } catch (e) {
        console.error("❌ Error:", e.message);
    } finally {
        await pool.end();
    }
}

run();
