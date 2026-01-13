const { Pool } = require('pg');
require('dotenv').config();

async function checkRbac() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    const addr = '0x7363d49c0ef0ae66ba7907f42932c340136d714f'.toLowerCase();
    try {
        const res = await pool.query('SELECT address, role FROM rbac_users WHERE LOWER(address) = $1', [addr]);
        console.log('RBAC_RESULTS:', res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
checkRbac();
