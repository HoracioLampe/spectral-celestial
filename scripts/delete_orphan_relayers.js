require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanOrphanRelayers() {
    try {
        console.log("🔍 Buscando relayers huérfanos (batch_id inexistente)...");

        // Count first
        const countRes = await pool.query(`
            SELECT COUNT(*) as count 
            FROM relayers 
            WHERE batch_id IS NOT NULL 
            AND batch_id NOT IN (SELECT id FROM batches)
        `);

        const count = parseInt(countRes.rows[0].count);

        if (count === 0) {
            console.log("✅ No se encontraron relayers huérfanos.");
        } else {
            console.log(`⚠️ Se encontraron ${count} relayers huérfanos. Eliminando...`);

            const deleteRes = await pool.query(`
                DELETE FROM relayers 
                WHERE batch_id IS NOT NULL 
                AND batch_id NOT IN (SELECT id FROM batches)
            `);

            console.log(`🗑️ Eliminados ${deleteRes.rowCount} relayers huérfanos.`);
        }

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await pool.end();
    }
}

cleanOrphanRelayers();
