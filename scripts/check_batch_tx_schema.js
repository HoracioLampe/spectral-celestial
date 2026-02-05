const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'batch_transactions'");
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
