// Script para corregir batches incompletos marcados como COMPLETED
// Cambia a SENT los batches donde sent_transactions < total_transactions

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixIncompleteCompletedBatches() {
    try {
        console.log('🔍 Buscando batches COMPLETED con transacciones incompletas...\n');

        // Buscar batches COMPLETED donde sent_transactions < total_transactions
        const findResult = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE status = 'COMPLETED' 
            AND sent_transactions < total_transactions
            ORDER BY id
        `);

        if (findResult.rows.length === 0) {
            console.log('✅ No hay batches COMPLETED con transacciones incompletas\n');
            return;
        }

        console.log(`⚠️  Encontrados ${findResult.rows.length} batches COMPLETED incompletos:\n`);
        findResult.rows.forEach(b => {
            console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} - Status: ${b.status}`);
        });

        // Cambiar status a SENT
        console.log('\n🔄 Cambiando status a SENT...');
        const updateResult = await pool.query(`
            UPDATE batches 
            SET status = 'SENT', updated_at = NOW()
            WHERE status = 'COMPLETED' 
            AND sent_transactions < total_transactions
        `);

        console.log(`✅ Actualizados: ${updateResult.rowCount} batches cambiados a SENT\n`);
        console.log('🎉 Corrección completada!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

fixIncompleteCompletedBatches();
