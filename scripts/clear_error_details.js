require('dotenv').config();
const { Pool } = require('pg');

async function clearErrorDetails() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // Clear detail field for FAILED batches with long error messages
        const result = await pool.query(`
            UPDATE batches 
            SET detail = NULL 
            WHERE status = 'FAILED' 
            AND LENGTH(detail) > 200
            RETURNING id, batch_number
        `);

        console.log(`✅ Cleared error details for ${result.rowCount} batches:`);
        result.rows.forEach(row => {
            console.log(`   - Batch ${row.id} (${row.batch_number})`);
        });

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await pool.end();
    }
}

clearErrorDetails();
