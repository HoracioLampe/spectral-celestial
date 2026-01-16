require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanDetails() {
    try {
        console.log("Cleaning corrupted 'detail' text in batches...");

        // Update 1: Move error detail to error_message if error_message is null
        const resCopy = await pool.query(`
            UPDATE batches 
            SET error_message = detail, detail = 'Error - Ver Detalle'
            WHERE (detail ILIKE '%server response%' OR detail ILIKE '%error:%' OR detail LIKE '❌%')
            AND error_message IS NULL
        `);
        console.log(`Moved errors to error_message: ${resCopy.rowCount}`);

        // Update 2: Just clear detail if error_message already exists
        const resClear = await pool.query(`
            UPDATE batches 
            SET detail = 'Error - Ver Detalle'
            WHERE (detail ILIKE '%server response%' OR detail ILIKE '%error:%' OR detail LIKE '❌%')
        `);
        console.log(`Cleared corrupted details: ${resClear.rowCount}`);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

cleanDetails();
