const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addIndex() {
    try {
        console.log("🛠️ Adding index to relayers.last_balance...");
        const client = await pool.connect();

        // We use a partial index that only includes rows with valid numeric strings
        // This prevents errors if there's garbage data in the text column
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_relayers_last_balance_numeric 
            ON relayers ((last_balance::numeric)) 
            WHERE last_balance ~ '^[0-9\.]+$';
        `);

        console.log("✅ Index 'idx_relayers_last_balance_numeric' created successfully.");
        client.release();
    } catch (err) {
        console.error("❌ Error creating index:", err.message);
    } finally {
        await pool.end();
    }
}

addIndex();
