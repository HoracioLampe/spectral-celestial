
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkLatest() {
    try {
        const res = await pool.query('SELECT * FROM faucets ORDER BY id DESC LIMIT 5');
        console.log("=== Latest 5 Faucets (System Fallback Candidates) ===");
        console.table(res.rows.map(r => ({
            id: r.id,
            address: r.address,
            funder: r.funder_address
        })));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkLatest();
