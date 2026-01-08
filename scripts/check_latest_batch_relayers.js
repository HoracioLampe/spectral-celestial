
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const res = await pool.query('SELECT id FROM batches ORDER BY id DESC LIMIT 3');
        const batchIds = res.rows.map(r => r.id);
        console.log('Checking batches:', batchIds);

        for (const id of batchIds) {
            const relRes = await pool.query('SELECT address, private_key FROM relayers WHERE batch_id = $1', [id]);
            console.log(`Relayers for Batch ${id}: ${relRes.rows.length}`);
            if (relRes.rows.length > 0) {
                relRes.rows.forEach(r => {
                    console.log(` - ${r.address} | PK: ${r.private_key ? r.private_key.substring(0, 15) + '...' : 'NULL'}`);
                });
            }
        }
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

run();
