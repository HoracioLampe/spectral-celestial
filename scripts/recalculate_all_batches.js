// Script para recalcular sent_transactions de TODOS los batches basándose en batch_transactions

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function recalculateAllBatches() {
    try {
        console.log('🔍 Recalculando sent_transactions para TODOS los batches...\n');

        // Obtener todos los batches
        const batches = await pool.query(`
            SELECT id, batch_number, status, sent_transactions, total_transactions
            FROM batches
            WHERE total_transactions > 0
            ORDER BY id
        `);

        console.log(`📊 Encontrados ${batches.rows.length} batches para verificar\n`);

        let updated = 0;
        let statusChanged = 0;

        for (const batch of batches.rows) {
            // Contar transacciones completadas reales
            const realCount = await pool.query(`
                SELECT COUNT(*) as completed
                FROM batch_transactions
                WHERE batch_id = $1 AND status = 'COMPLETED'
            `, [batch.id]);

            const realCompleted = parseInt(realCount.rows[0].completed);

            // Si el conteo es diferente, actualizar
            if (realCompleted !== batch.sent_transactions) {
                console.log(`⚠️  Batch ${batch.id} (${batch.batch_number}): BD dice ${batch.sent_transactions}/${batch.total_transactions}, REAL es ${realCompleted}/${batch.total_transactions}`);

                await pool.query(`
                    UPDATE batches
                    SET sent_transactions = $1, updated_at = NOW()
                    WHERE id = $2
                `, [realCompleted, batch.id]);

                updated++;

                // Determinar status correcto
                let correctStatus = batch.status;
                if (realCompleted === 0) {
                    correctStatus = 'READY';
                } else if (realCompleted === batch.total_transactions) {
                    correctStatus = 'COMPLETED';
                } else if (realCompleted > 0 && realCompleted < batch.total_transactions) {
                    correctStatus = 'FAILED';
                }

                // Actualizar status si es necesario
                if (correctStatus !== batch.status && !['PROCESSING', 'SENT', 'PREPARING'].includes(batch.status)) {
                    console.log(`   → Cambiando status: ${batch.status} → ${correctStatus}`);
                    await pool.query(`
                        UPDATE batches
                        SET status = $1, updated_at = NOW()
                        WHERE id = $2
                    `, [correctStatus, batch.id]);
                    statusChanged++;
                }
            }
        }

        console.log(`\n✅ Recalculación completada:`);
        console.log(`   - ${updated} batches con sent_transactions actualizado`);
        console.log(`   - ${statusChanged} batches con status corregido`);
        console.log(`   - ${batches.rows.length - updated} batches ya estaban correctos`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

recalculateAllBatches();
