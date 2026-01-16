// Script para arreglar la tabla batches
// 1. Recargar sent_transactions con el conteo real
// 2. Borrar batches con status SENT

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixBatches() {
    try {
        console.log('🔧 Iniciando corrección de batches...\n');

        // Paso 1: Actualizar sent_transactions
        console.log('📊 Paso 1: Actualizando sent_transactions con conteo real...');
        const updateResult = await pool.query(`
            UPDATE batches b
            SET sent_transactions = (
                SELECT COUNT(*) 
                FROM batch_transactions bt 
                WHERE bt.batch_id = b.id
            )
            WHERE b.id IN (SELECT DISTINCT batch_id FROM batch_transactions)
        `);
        console.log(`✅ Actualizado: ${updateResult.rowCount} batches\n`);

        // Paso 2: Verificar batches con status SENT
        console.log('🔍 Paso 2: Verificando batches con status SENT...');
        const sentBatches = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE status = 'SENT'
            ORDER BY id
        `);

        if (sentBatches.rows.length > 0) {
            console.log(`⚠️  Encontrados ${sentBatches.rows.length} batches con status SENT:`);
            sentBatches.rows.forEach(b => {
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions}`);
            });

            // Paso 3: Borrar batches SENT
            console.log('\n🗑️  Paso 3: Borrando batches con status SENT...');
            const deleteResult = await pool.query(`DELETE FROM batches WHERE status = 'SENT'`);
            console.log(`✅ Borrados: ${deleteResult.rowCount} batches\n`);
        } else {
            console.log('✅ No hay batches con status SENT\n');
        }

        console.log('🎉 Corrección completada exitosamente!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

fixBatches();
