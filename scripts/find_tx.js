
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findTx() {
    try {
        const address = '0xa9fB4Bb31209C88449a970521Bb62268E15bE9C8';
        console.log(`🔍 Searching for address: ${address}`);

        // 1. Search in global transactions table (to_address)
        const resQuery = 'SELECT * FROM transactions WHERE LOWER(to_address) = LOWER($1)';
        const res = await pool.query(resQuery, [address]);
        if (res.rows.length > 0) {
            console.log('✅ Found in global transactions:');
            console.log(JSON.stringify(res.rows, null, 2));
        } else {
            console.log('❌ Not found in global transactions.');
        }

        // 2. Search in batch_transactions table (wallet_address_to)
        const resBatchQuery = 'SELECT * FROM batch_transactions WHERE LOWER(wallet_address_to) = LOWER($1)';
        const resBatch = await pool.query(resBatchQuery, [address]);
        if (resBatch.rows.length > 0) {
            console.log('✅ Found in batch_transactions:');
            console.log(JSON.stringify(resBatch.rows, null, 2));
        } else {
            console.log('❌ Not found in batch_transactions.');
        }

    } catch (err) {
        console.error('❌ Database error:', err);
    } finally {
        await pool.end();
    }
}

findTx();
