require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function showRelayersColumns() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'relayers'
            ORDER BY ordinal_position
        `);

        console.log("📊 Columns in relayers table:\n");
        res.rows.forEach(row => console.log(`  - ${row.column_name} (${row.data_type})`));

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await pool.end();
    }
}

showRelayersColumns();
