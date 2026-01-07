
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function dumpJSON() {
    try {
        const res = await pool.query(`
            SELECT address, transactionhash_deposit, last_balance, status, last_activity 
            FROM relayers 
            WHERE transactionhash_deposit IS NOT NULL 
            ORDER BY last_activity DESC 
            LIMIT 20
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

dumpJSON();
