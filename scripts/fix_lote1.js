// Script para verificar y corregir el Lote 1 específicamente

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixLote1() {
    try {
        console.log('🔍 Verificando Lote 1...\n');

        // Buscar el batch con batch_number = '1'
        const result = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE batch_number = '1'
            ORDER BY id DESC
            LIMIT 5
        `);

        console.log(`Encontrados ${result.rows.length} batches con número '1':\n`);
        result.rows.forEach(b => {
            console.log(`   - Batch ID ${b.id}: ${b.sent_transactions}/${b.total_transactions} - Status: ${b.status}`);
        });

        // Buscar batches con 1000/1000 y status SENT
        console.log('\n🔍 Buscando batches con 1000/1000 y status SENT...\n');
        const sent1000 = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions = 1000
            AND total_transactions = 1000
            AND status = 'SENT'
            ORDER BY id
        `);

        if (sent1000.rows.length > 0) {
            console.log(`⚠️  Encontrados ${sent1000.rows.length} batches 1000/1000 con status SENT:\n`);
            sent1000.rows.forEach(b => {
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} - Status: ${b.status}`);
            });

            console.log('\n🔄 Cambiando a COMPLETED...');
            const update = await pool.query(`
                UPDATE batches 
                SET status = 'COMPLETED', updated_at = NOW()
                WHERE sent_transactions = 1000
                AND total_transactions = 1000
                AND status = 'SENT'
            `);
            console.log(`✅ Actualizados: ${update.rowCount} batches\n`);
        } else {
            console.log('✅ No hay batches 1000/1000 con status SENT\n');
        }

        console.log('🎉 Verificación completada!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

fixLote1();
