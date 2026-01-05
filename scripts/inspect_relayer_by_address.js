require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const address = '0x70135F4B7d979dbFFB20A171b902d7a47eA88468';
    try {
        const res = await pool.query('SELECT * FROM relayers WHERE address = $1', [address]);
        console.log('Relayer Data:', JSON.stringify(res.rows, null, 2));
        if (res.rows.length > 0) {
            const batch = await pool.query('SELECT * FROM batches WHERE id = $1', [res.rows[0].batch_id]);
            console.log('Relayer Batch:', JSON.stringify(batch.rows, null, 2));
        } else {
            console.log('Relayer not found in database.');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
