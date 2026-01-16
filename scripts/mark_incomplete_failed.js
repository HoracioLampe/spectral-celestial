// Script para marcar como FAILED los batches con transacciones incompletas

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function markIncompleteAsFailed() {
    try {
        console.log('🔍 Buscando batches incompletos marcados como COMPLETED...\n');

        // Buscar batches donde sent_transactions < total_transactions pero status = COMPLETED
        const incomplete = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions > 0
            AND sent_transactions < total_transactions
            AND status = 'COMPLETED'
            ORDER BY id
        `);

        if (incomplete.rows.length === 0) {
            console.log('✅ No hay batches incompletos marcados como COMPLETED\n');
            return;
        }

        console.log(`⚠️  Encontrados ${incomplete.rows.length} batches incompletos marcados como COMPLETED:\n`);
        incomplete.rows.forEach(b => {
            const percentage = ((b.sent_transactions / b.total_transactions) * 100).toFixed(1);
            console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} (${percentage}%) - Status: ${b.status} → FAILED`);
        });

        console.log('\n🔄 Cambiando status a FAILED...');
        const update = await pool.query(`
            UPDATE batches 
            SET status = 'FAILED', updated_at = NOW()
            WHERE sent_transactions > 0
            AND sent_transactions < total_transactions
            AND status = 'COMPLETED'
        `);

        console.log(`✅ Actualizados: ${update.rowCount} batches marcados como FAILED\n`);
        console.log('🎉 Corrección completada!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

markIncompleteAsFailed();
