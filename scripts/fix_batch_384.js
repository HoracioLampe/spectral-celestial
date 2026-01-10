// Verificar el batch ID 384 (Lote 2112) que muestra 586/1000 en la UI

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkAndFixBatch384() {
    try {
        console.log('🔍 Verificando Batch ID 384 (Lote 2112)...\n');

        // Ver el estado actual
        const current = await pool.query(`
            SELECT id, batch_number, detail, status, sent_transactions, total_transactions
            FROM batches
            WHERE id = 384
        `);

        if (current.rows.length === 0) {
            console.log('❌ Batch 384 no encontrado');
            return;
        }

        const b = current.rows[0];
        console.log('📊 Estado ACTUAL en la base de datos:');
        console.log(`   - ID: ${b.id}`);
        console.log(`   - Batch Number: ${b.batch_number}`);
        console.log(`   - Detail: ${b.detail}`);
        console.log(`   - Status: ${b.status}`);
        console.log(`   - Sent/Total: ${b.sent_transactions}/${b.total_transactions}`);

        // Contar transacciones REALES en batch_transactions
        const realCount = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed
            FROM batch_transactions
            WHERE batch_id = 384
        `);

        const rc = realCount.rows[0];
        console.log('\n📊 Transacciones REALES en batch_transactions:');
        console.log(`   - Total: ${rc.total}`);
        console.log(`   - Completed: ${rc.completed}`);
        console.log(`   - Pending: ${rc.pending}`);
        console.log(`   - Failed: ${rc.failed}`);

        // Actualizar sent_transactions con el conteo real
        console.log('\n🔄 Actualizando sent_transactions con conteo real...');
        await pool.query(`
            UPDATE batches
            SET sent_transactions = (
                SELECT COUNT(*) FROM batch_transactions WHERE batch_id = 384 AND status = 'COMPLETED'
            ),
            updated_at = NOW()
            WHERE id = 384
        `);

        // Ver el nuevo estado
        const updated = await pool.query(`
            SELECT sent_transactions, total_transactions, status
            FROM batches
            WHERE id = 384
        `);

        const u = updated.rows[0];
        console.log(`✅ sent_transactions actualizado: ${u.sent_transactions}/${u.total_transactions}`);

        // Determinar el status correcto
        let correctStatus = u.status;
        if (u.sent_transactions === 0) {
            correctStatus = 'READY';
        } else if (u.sent_transactions === u.total_transactions) {
            correctStatus = 'COMPLETED';
        } else if (u.sent_transactions > 0 && u.sent_transactions < u.total_transactions) {
            correctStatus = 'FAILED';
        }

        if (correctStatus !== u.status) {
            console.log(`\n⚠️  Status incorrecto: ${u.status} → ${correctStatus}`);
            console.log('🔄 Actualizando status...');
            await pool.query(`UPDATE batches SET status = $1, updated_at = NOW() WHERE id = 384`, [correctStatus]);
            console.log(`✅ Status actualizado a: ${correctStatus}`);
        } else {
            console.log(`\n✅ Status correcto: ${u.status}`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

checkAndFixBatch384();
