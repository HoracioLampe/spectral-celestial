require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanNoDuration() {
    try {
        console.log("🧹 Borrando batches sin 'execution_time' y transacciones huérfanas...");

        // 1. Borrar Transacciones Huérfanas (que no tienen batch padre)
        console.log("👻 Buscando transacciones huérfanas...");
        const orphanRes = await pool.query(`
            DELETE FROM batch_transactions 
            WHERE batch_id NOT IN (SELECT id FROM batches)
        `);
        console.log(`   -> Eliminas ${orphanRes.rowCount} transacciones huérfanas.`);

        // 2. Identificar batches "No Duration"
        const findQuery = "SELECT id, batch_number, execution_time FROM batches WHERE execution_time IS NULL OR execution_time = ''";
        const resFiles = await pool.query(findQuery);

        if (resFiles.rows.length === 0) {
            console.log("✅ No hay batches sin duración para borrar.");
        } else {
            console.log(`⚠️ Eliminando ${resFiles.rows.length} batches sin duración...`);

            for (const batch of resFiles.rows) {
                console.log(`\n🔹 Eliminando Batch ID: ${batch.id}...`);

                // Delete dependencies first
                await pool.query("DELETE FROM batch_transactions WHERE batch_id = $1", [batch.id]);
                await pool.query("DELETE FROM merkle_nodes WHERE batch_id = $1", [batch.id]);
                await pool.query("DELETE FROM relayers WHERE batch_id = $1", [batch.id]);

                // Delete batch
                await pool.query("DELETE FROM batches WHERE id = $1", [batch.id]);
                console.log(`   ✅ Elimnado.`);
            }
        }

        console.log("\n✨ Limpieza Finalizada.");

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await pool.end();
    }
}

cleanNoDuration();
