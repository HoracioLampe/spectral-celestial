const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkStuck() {
    try {
        console.log("BATCHES WITH PENDING/FAILED/SENDING:");
        const res = await pool.query(`
            SELECT b.id, b.status, 
                   count(case when bt.status != 'COMPLETED' then 1 end) as stuck_count,
                   count(case when bt.status = 'PENDING' then 1 end) as pending,
                   count(case when bt.status = 'ENVIANDO' then 1 end) as sending,
                   count(case when bt.status = 'FAILED' then 1 end) as failed
            FROM batches b
            JOIN batch_transactions bt ON b.id = bt.batch_id
            GROUP BY b.id, b.status
            HAVING count(case when bt.status != 'COMPLETED' then 1 end) > 0
            ORDER BY b.id DESC
            LIMIT 5
        `);

        res.rows.forEach(r => console.log(JSON.stringify(r)));

        if (res.rows.length > 0) {
            const batchId = res.rows[0].id; // Pick the latest one
            console.log(`\n--- First 10 stuck txs for Batch ${batchId} ---`);
            const stuck = await pool.query(`
                SELECT id, status, retry_count, updated_at 
                FROM batch_transactions 
                WHERE batch_id = $1 AND status != 'COMPLETED'
                LIMIT 10
            `, [batchId]);
            stuck.rows.forEach(r => console.log(JSON.stringify(r)));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkStuck();
