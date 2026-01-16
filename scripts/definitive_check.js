const { Pool } = require('pg');
require('dotenv').config();

async function checkStatus() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    const addr = '0x7363d49c0ef0ae66ba7907f42932c340136d714f'.toLowerCase();
    try {
        const faucets = await pool.query('SELECT * FROM faucets WHERE LOWER(funder_address) = $1 OR LOWER(address) = $1', [addr]);
        const rbac = await pool.query('SELECT * FROM rbac_users WHERE LOWER(address) = $1', [addr]);
        const sessions = await pool.query('SELECT COUNT(*) FROM session');

        console.log('--- DATABASE STATUS ---');
        console.log('FAUCETS MATCHES:', faucets.rows.length);
        console.log('RBAC MATCHES:', rbac.rows.length);
        console.log('STILL IN FAUCETS:', faucets.rows);
        console.log('TOTAL SESSIONS:', sessions.rows[0].count);
        console.log('-----------------------');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
checkStatus();
