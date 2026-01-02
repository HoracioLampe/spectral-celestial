const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Assuming similar config to server.js
});

async function checkTable() {
    try {
        const res = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public'
                AND table_name = 'merkle_nodes'
            );
        `);
        console.log("Does merkle_nodes table exist?", res.rows[0].exists);

        if (res.rows[0].exists) {
            const countRes = await pool.query('SELECT COUNT(*) FROM merkle_nodes');
            console.log("Total rows in merkle_nodes:", countRes.rows[0].count);
        }

    } catch (err) {
        console.error("Error checking table:", err);
    } finally {
        await pool.end();
    }
}

checkTable();
