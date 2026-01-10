// Script para verificar el Batch ID 385 en detalle

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkBatch385() {
    try {
        console.log('🔍 Verificando Batch ID 385 en detalle...\n');

        // Obtener información completa del batch
        const batch = await pool.query(`
            SELECT * FROM batches WHERE id = 385
        `);

        if (batch.rows.length === 0) {
            console.log('❌ Batch 385 no encontrado');
            return;
        }

        const b = batch.rows[0];
        console.log('📊 Información del Batch 385:');
        console.log(`   - ID: ${b.id}`);
        console.log(`   - Batch Number: ${b.batch_number}`);
        console.log(`   - Detail: ${b.detail}`);
        console.log(`   - Status: ${b.status}`);
        console.log(`   - Total Transactions: ${b.total_transactions}`);
        console.log(`   - Sent Transactions: ${b.sent_transactions}`);
        console.log(`   - Created At: ${b.created_at}`);
        console.log(`   - Updated At: ${b.updated_at}`);

        // Contar transacciones reales en batch_transactions
        const txCount = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed
            FROM batch_transactions
            WHERE batch_id = 385
        `);

        console.log('\n📊 Transacciones en batch_transactions:');
        console.log(`   - Total: ${txCount.rows[0].total}`);
        console.log(`   - Completed: ${txCount.rows[0].completed}`);
        console.log(`   - Pending: ${txCount.rows[0].pending}`);
        console.log(`   - Failed: ${txCount.rows[0].failed}`);

        // Actualizar sent_transactions con el conteo real
        console.log('\n🔄 Actualizando sent_transactions con conteo real...');
        await pool.query(`
            UPDATE batches
            SET sent_transactions = (
                SELECT COUNT(*) FROM batch_transactions WHERE batch_id = 385 AND status = 'COMPLETED'
            )
            WHERE id = 385
        `);

        const updated = await pool.query(`SELECT sent_transactions FROM batches WHERE id = 385`);
        console.log(`✅ sent_transactions actualizado a: ${updated.rows[0].sent_transactions}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

checkBatch385();
