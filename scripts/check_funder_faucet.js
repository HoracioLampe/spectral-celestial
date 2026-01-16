const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const FUNDER = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0';

async function check() {
    try {
        console.log(`🔍 Checking Faucet for Funder: ${FUNDER}`);

        const res = await pool.query('SELECT * FROM faucets WHERE LOWER(funder_address) = LOWER($1)', [FUNDER]);
        if (res.rows.length === 0) {
            console.log("❌ NO specified Faucet found for this Funder.");
        } else {
            console.log("✅ Faucet Found:", res.rows[0]);
        }

        // Check Global Fallback Availability
        const globalRes = await pool.query('SELECT address FROM faucets ORDER BY id DESC LIMIT 1');
        console.log("🌍 Global Latest Faucet:", globalRes.rows[0]);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

check();
