const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const TARGET_ADDRESS = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0';

async function checkUserBatches() {
    console.log(`🔍 Checking Batches for: ${TARGET_ADDRESS}`);
    const client = await pool.connect();
    try {
        // 1. Check Exact Match (Lowercase)
        const resLower = await client.query(
            `SELECT COUNT(*) FROM batches WHERE LOWER(funder_address) = $1`,
            [TARGET_ADDRESS.toLowerCase()]
        );
        console.log(`[LOWERCASE MATCH] Count: ${resLower.rows[0].count}`);

        // 2. Check Exact Match (As Is - just in case)
        const resExact = await client.query(
            `SELECT COUNT(*) FROM batches WHERE funder_address = $1`,
            [TARGET_ADDRESS]
        );
        console.log(`[EXACT MATCH] Count: ${resExact.rows[0].count}`);

        // 3. Check NULLs (Orphaned)
        const resNull = await client.query(`SELECT COUNT(*) FROM batches WHERE funder_address IS NULL`);
        console.log(`[ORPHANED (NULL)] Count: ${resNull.rows[0].count}`);

        // 4. List a few IDs
        const listRes = await client.query(
            `SELECT id, status, created_at FROM batches WHERE LOWER(funder_address) = $1 ORDER BY created_at DESC LIMIT 5`,
            [TARGET_ADDRESS.toLowerCase()]
        );
        console.log("Recent Batches:", listRes.rows);

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

checkUserBatches();
