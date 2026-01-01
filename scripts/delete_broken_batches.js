require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanBatches() {
    try {
        console.log("🧹 Iniciando limpieza OPTIMIZADA de batches corruptos...");

        // 1. Identificar batches a borrar
        const findQuery = "SELECT id, batch_number FROM batches WHERE merkle_root IS NULL OR merkle_root = ''";
        const resFiles = await pool.query(findQuery);

        if (resFiles.rows.length === 0) {
            console.log("✅ No se encontraron batches con Merkle Root nulo.");
            process.exit(0);
        }

        console.log(`⚠️ Se encontraron ${resFiles.rows.length} batches para eliminar.`);

        // 2. Procesar UNO POR UNO para evitar bloqueos
        let deletedBatches = 0;

        for (const batch of resFiles.rows) {
            console.log(`\n🔹 Procesando Batch ID: ${batch.id} (Ref: ${batch.batch_number})...`);

            try {
                // A. Borrar transacciones en chunks (si son muchas) o directo si el índice ayuda
                // Intentamos un delete directo primero, pero logueando tiempo
                const startTx = Date.now();
                const txRes = await pool.query("DELETE FROM batch_transactions WHERE batch_id = $1", [batch.id]);
                console.log(`   -> Borradas ${txRes.rowCount} transacciones en ${(Date.now() - startTx) / 1000}s`);

                // B. Borrar nodos merkle
                const nodesRes = await pool.query("DELETE FROM merkle_nodes WHERE batch_id = $1", [batch.id]);
                if (nodesRes.rowCount > 0) console.log(`   -> Borrados ${nodesRes.rowCount} nodos Merkle.`);

                // C. Borrar relayers (si aplica)
                await pool.query("DELETE FROM relayers WHERE batch_id = $1", [batch.id]);

                // D. Borrar el batch
                await pool.query("DELETE FROM batches WHERE id = $1", [batch.id]);
                console.log(`   ✅ Batch ${batch.id} eliminado.`);

                deletedBatches++;

            } catch (errInner) {
                console.error(`   ❌ Error borrando Batch ${batch.id}: ${errInner.message}`);
            }
        }

        console.log(`\n✨ Limpieza finalizada. ${deletedBatches}/${resFiles.rows.length} batches eliminados.`);

    } catch (err) {
        console.error("❌ Error General:", err);
    } finally {
        await pool.end();
    }
}

cleanBatches();
