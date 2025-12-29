const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkColumns() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'batches'");
        console.log("Columns in 'batches' table:");
        res.rows.forEach(r => console.log(` - ${r.column_name} (${r.data_type})`));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

checkColumns();
