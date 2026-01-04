require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function showTransactionStatus() {
    try {
        const res = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM batch_transactions
            GROUP BY status
            ORDER BY count DESC
        `);

        console.log("📊 Transaction Status Summary:\n");
        let total = 0;
        res.rows.forEach(row => {
            console.log(`  ${row.status}: ${row.count}`);
            total += parseInt(row.count);
        });
        console.log(`\n  TOTAL: ${total}`);

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await pool.end();
    }
}

showTransactionStatus();
