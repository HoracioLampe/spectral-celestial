const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspect() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'rbac_users';
        `);
        console.table(res.rows);

        const rows = await pool.query('SELECT * FROM rbac_users LIMIT 1');
        console.log("Sample User:", rows.rows[0]);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspect();
