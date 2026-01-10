// Script completo para corregir TODOS los estados de batches según su progreso

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixAllBatchStatuses() {
    try {
        console.log('🔍 Corrigiendo TODOS los estados de batches...\n');

        // CASO 1: Batches con 0 transacciones completadas → READY
        console.log('📊 CASO 1: Batches con 0 transacciones → READY');
        const case1 = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions = 0
            AND total_transactions > 0
            AND status NOT IN ('READY', 'PREPARING')
            ORDER BY id
        `);

        if (case1.rows.length > 0) {
            console.log(`⚠️  Encontrados ${case1.rows.length} batches sin transacciones:\n`);
            case1.rows.forEach(b => {
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} - ${b.status} → READY`);
            });

            const update1 = await pool.query(`
                UPDATE batches 
                SET status = 'READY', updated_at = NOW()
                WHERE sent_transactions = 0
                AND total_transactions > 0
                AND status NOT IN ('READY', 'PREPARING')
            `);
            console.log(`✅ ${update1.rowCount} batches cambiados a READY\n`);
        } else {
            console.log('✅ No hay batches con 0 transacciones en estado incorrecto\n');
        }

        // CASO 2: Batches 100% completados → COMPLETED
        console.log('📊 CASO 2: Batches 100% completados → COMPLETED');
        const case2 = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions = total_transactions
            AND total_transactions > 0
            AND status != 'COMPLETED'
            ORDER BY id
        `);

        if (case2.rows.length > 0) {
            console.log(`⚠️  Encontrados ${case2.rows.length} batches completados:\n`);
            case2.rows.forEach(b => {
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} - ${b.status} → COMPLETED`);
            });

            const update2 = await pool.query(`
                UPDATE batches 
                SET status = 'COMPLETED', updated_at = NOW()
                WHERE sent_transactions = total_transactions
                AND total_transactions > 0
                AND status != 'COMPLETED'
            `);
            console.log(`✅ ${update2.rowCount} batches cambiados a COMPLETED\n`);
        } else {
            console.log('✅ No hay batches completados en estado incorrecto\n');
        }

        // CASO 3: Batches parcialmente completados → FAILED
        console.log('📊 CASO 3: Batches parcialmente completados → FAILED');
        const case3 = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE sent_transactions > 0
            AND sent_transactions < total_transactions
            AND status NOT IN ('FAILED', 'PROCESSING', 'SENT')
            ORDER BY id
        `);

        if (case3.rows.length > 0) {
            console.log(`⚠️  Encontrados ${case3.rows.length} batches parcialmente completados:\n`);
            case3.rows.forEach(b => {
                const pct = ((b.sent_transactions / b.total_transactions) * 100).toFixed(1);
                console.log(`   - Batch ${b.id} (${b.batch_number}): ${b.sent_transactions}/${b.total_transactions} (${pct}%) - ${b.status} → FAILED`);
            });

            const update3 = await pool.query(`
                UPDATE batches 
                SET status = 'FAILED', updated_at = NOW()
                WHERE sent_transactions > 0
                AND sent_transactions < total_transactions
                AND status NOT IN ('FAILED', 'PROCESSING', 'SENT')
            `);
            console.log(`✅ ${update3.rowCount} batches cambiados a FAILED\n`);
        } else {
            console.log('✅ No hay batches parcialmente completados en estado incorrecto\n');
        }

        console.log('🎉 Corrección completada!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

fixAllBatchStatuses();
