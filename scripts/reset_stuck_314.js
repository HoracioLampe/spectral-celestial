
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetStuck() {
    try {
        console.log("🛠️ Reseteando transacciones 'ENVIANDO' a 'PENDING' para Batch 314...");

        const res = await pool.query(`
            UPDATE batch_transactions 
            SET status = 'PENDING', relayer_address = NULL, updated_at = NOW()
            WHERE batch_id = 314 AND status = 'ENVIANDO'
            RETURNING id
        `);

        console.log(`✅ ${res.rowCount} transacciones reseteadas y listas para procesar.`);

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

resetStuck();
