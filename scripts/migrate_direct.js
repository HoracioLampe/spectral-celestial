const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway",
});

async function runFix() {
    const client = await pool.connect();
    try {
        console.log("Connected to database. Checking schema...");

        // Add updated_at column to batches if it doesn't exist
        await client.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
        `);

        console.log("✅ Column 'updated_at' ensured in 'batches' table.");

        const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'batches'");
        console.log("Columns in 'batches':", res.rows.map(r => r.column_name).join(", "));

    } catch (err) {
        console.error("❌ Error fixing database:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

runFix();
