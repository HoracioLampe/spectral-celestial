// Verificar estado actual del Lote 2112

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkBatch2112() {
    try {
        console.log('🔍 Verificando Lote 2112...\n');

        const result = await pool.query(`
            SELECT id, batch_number, detail, status, sent_transactions, total_transactions, updated_at
            FROM batches
            WHERE batch_number = '2112'
            ORDER BY id DESC
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            console.log('❌ Lote 2112 no encontrado');
            return;
        }

        const b = result.rows[0];
        console.log('📊 Estado actual del Lote 2112:');
        console.log(`   - ID: ${b.id}`);
        console.log(`   - Batch Number: ${b.batch_number}`);
        console.log(`   - Detail: ${b.detail}`);
        console.log(`   - Status: ${b.status}`);
        console.log(`   - Sent/Total: ${b.sent_transactions}/${b.total_transactions}`);
        console.log(`   - Updated At: ${b.updated_at}`);

        if (b.sent_transactions < b.total_transactions && b.status === 'COMPLETED') {
            console.log('\n⚠️  Este batch está INCOMPLETO pero marcado como COMPLETED');
            console.log('🔄 Cambiando a FAILED...');
            await pool.query(`UPDATE batches SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [b.id]);
            console.log('✅ Status actualizado a FAILED');
        } else if (b.sent_transactions < b.total_transactions) {
            console.log(`\n✅ Status correcto: ${b.status} (batch incompleto)`);
        } else {
            console.log('\n✅ Batch completado correctamente');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

checkBatch2112();
