require('dotenv').config();
const { Pool } = require('pg');

async function inspect() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const target = '0x6b83b40904Fe6708Ea69E3e9e9f03Ec5F23F3792';
    const res = await pool.query("SELECT address, last_balance, transactionhash_deposit FROM relayers WHERE address = $1", [target]);
    console.log(res.rows[0]);
    await pool.end();
}

inspect();
