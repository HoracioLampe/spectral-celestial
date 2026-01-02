const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const TARGET_ADDRESS = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0'.toLowerCase();

async function debugApiQuery() {
    const client = await pool.connect();
    try {
        console.log(`🔍 Testing API Query for: ${TARGET_ADDRESS}`);

        // 1. Params Setup
        const limit = 20;
        const offset = 0;

        let whereClause = 'WHERE LOWER(b.funder_address) = $1';
        let queryParams = [TARGET_ADDRESS];

        // 2. Count Query
        const countQuery = `SELECT COUNT(*) FROM batches b ${whereClause}`;
        console.log(`\n[Count Query] ${countQuery}`);
        const countRes = await client.query(countQuery, queryParams);
        console.log(`[Count Result] ${countRes.rows[0].count}`);

        // 3. Data Query (Exact copy from server.js)
        const dataQuery = `
            SELECT b.*,
            COUNT(CASE WHEN t.status = 'COMPLETED' THEN 1 END)::int as sent_transactions,
            COUNT(t.id)::int as total_transactions
            FROM batches b 
            LEFT JOIN batch_transactions t ON b.id = t.batch_id
            ${whereClause}
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        const dataParams = [...queryParams, limit, offset];
        console.log(`\n[Data Query] ${dataQuery}`);
        console.log(`[Params] ${JSON.stringify(dataParams)}`);

        const res = await client.query(dataQuery, dataParams);
        console.log(`\n[Data Result] Rows Found: ${res.rows.length}`);

        if (res.rows.length > 0) {
            console.log("First Batch:", JSON.stringify(res.rows[0], null, 2));
        } else {
            console.warn("⚠️ No rows returned by Data Query!");
        }

    } catch (e) {
        console.error("❌ Query Error:", e);
    } finally {
        client.release();
        pool.end();
    }
}

debugApiQuery();
