const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const funder = '0x7363d49c0ef0ae66ba7907f42932c340136d714f'.toLowerCase();

async function run() {
    try {
        const res = await pool.query('SELECT address, funder_address FROM faucets WHERE LOWER(funder_address) = $1', [funder]);
        console.log('RESULT_START');
        console.log(JSON.stringify(res.rows, null, 2));
        console.log('RESULT_END');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
