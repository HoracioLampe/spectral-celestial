const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findBatch() {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT batch_id, COUNT(*) as tx_count 
            FROM batch_transactions 
            GROUP BY batch_id 
            ORDER BY tx_count DESC 
            LIMIT 10;
        `);
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        pool.end();
    }
}

findBatch();
