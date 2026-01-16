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
            WHERE table_name = 'faucets';
        `);
        console.table(res.rows);

        // Also check if there are existing rows
        const rows = await pool.query('SELECT * FROM faucets LIMIT 5');
        console.log("Existing Faucets:", rows.rows);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspect();
