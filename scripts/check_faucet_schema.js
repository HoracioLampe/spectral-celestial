const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
    try {
        console.log("--- FAUCETS ---");
        const resF = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'faucets';
        `);
        resF.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));

        console.log("\n--- BATCHES ---");
        const resB = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'batches';
        `);
        resB.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkSchema();
