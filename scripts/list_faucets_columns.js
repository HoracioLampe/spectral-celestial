
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function find() {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'faucets'");
    console.log(`Columns in 'faucets' table:`);
    res.rows.forEach(r => console.log(` - ${r.column_name}`));
    process.exit(0);
}

find();
