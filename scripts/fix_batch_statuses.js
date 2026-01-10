// Script para corregir estados incorrectos de batches
// 1. Batches con sent_transactions = total_transactions pero status != COMPLETED → cambiar a COMPLETED
// 2. Batches con sent_transactions < total_transactions pero status = COMPLETED → cambiar a SENT

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixBatchStatuses() {
    try {
        console.log('🔍 Buscando batches con estados incorrectos...\n');

        // Caso 1: Batches completados pero marcados como SENT
        console.log('📊 Caso 1: Batches 100% completados marcados como SENT');
        const case1 = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions = total_transactions
            AND total_transactions > 0
            AND status != 'COMPLETED'
            ORDER BY id
        `);

        if (case1.rows.length > 0) {
            console.log(`⚠️  Encontrados ${case1.rows.length} batches completados marcados incorrectamente:\n`);
            case1.rows.forEach(b => {
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} - Status: ${b.status} → COMPLETED`);
            });

            const update1 = await pool.query(`
                UPDATE batches 
                SET status = 'COMPLETED', updated_at = NOW()
                WHERE sent_transactions = total_transactions
                AND total_transactions > 0
                AND status != 'COMPLETED'
            `);
            console.log(`✅ Actualizados: ${update1.rowCount} batches a COMPLETED\n`);
        } else {
            console.log('✅ No hay batches completados con status incorrecto\n');
        }

        // Caso 2: Batches incompletos marcados como COMPLETED
        console.log('📊 Caso 2: Batches incompletos marcados como COMPLETED');
        const case2 = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions < total_transactions
            AND status = 'COMPLETED'
            ORDER BY id
        `);

        if (case2.rows.length > 0) {
            console.log(`⚠️  Encontrados ${case2.rows.length} batches incompletos marcados como COMPLETED:\n`);
            case2.rows.forEach(b => {
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} - Status: ${b.status} → FAILED`);
            });

            const update2 = await pool.query(`
                UPDATE batches 
                SET status = 'FAILED', updated_at = NOW()
                WHERE sent_transactions < total_transactions
                AND status = 'COMPLETED'
            `);
            console.log(`✅ Actualizados: ${update2.rowCount} batches a FAILED\n`);
        } else {
            console.log('✅ No hay batches incompletos marcados como COMPLETED\n');
        }

        console.log('🎉 Corrección completada!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

fixBatchStatuses();
