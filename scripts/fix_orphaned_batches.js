const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const TARGET_ADDRESS = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0';

async function fixOrphans() {
    const client = await pool.connect();
    try {
        console.log(`🔧 Assigning orphaned batches to: ${TARGET_ADDRESS}`);

        const res = await client.query(
            `UPDATE batches SET funder_address = $1 WHERE funder_address IS NULL OR funder_address = '' RETURNING id`,
            [TARGET_ADDRESS.toLowerCase()]
        );

        console.log(`✅ Fixed ${res.rowCount} batches. IDs: ${res.rows.map(r => r.id).join(', ')}`);
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

fixOrphans();
