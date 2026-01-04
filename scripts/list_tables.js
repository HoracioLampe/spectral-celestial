require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function listTables() {
    try {
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        console.log("📊 Tables in database:\n");
        res.rows.forEach(row => console.log(`  - ${row.table_name}`));

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await pool.end();
    }
}

listTables();
