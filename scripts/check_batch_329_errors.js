require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkBatch329Errors() {
    try {
        const batchId = 329;

        console.log(`\n🔍 Buscando errores en Batch ${batchId}...\n`);

        // Check for any error messages in transactions
        const errorsRes = await pool.query(`
            SELECT 
                id,
                wallet_address_to,
                status,
                error_message,
                retry_count,
                updated
            FROM batch_transactions
            WHERE batch_id = $1
            AND (error_message IS NOT NULL OR retry_count > 0)
            ORDER BY id
            LIMIT 10
        `, [batchId]);

        if (errorsRes.rows.length === 0) {
            console.log('✅ No hay mensajes de error registrados en las transacciones\n');
        } else {
            console.log(`⚠️  Transacciones con errores (${errorsRes.rows.length}):`);
            console.log('─────────────────────────────────────────────────────');
            errorsRes.rows.forEach(tx => {
                console.log(`\nTX ${tx.id}:`);
                console.log(`  Wallet: ${tx.wallet_address_to?.substring(0, 15)}...`);
                console.log(`  Status: ${tx.status}`);
                console.log(`  Retries: ${tx.retry_count}`);
                console.log(`  Error: ${tx.error_message || 'N/A'}`);
            });
            console.log('');
        }

        // Check batch status
        const batchRes = await pool.query(`
            SELECT status, error_message
            FROM batches
            WHERE id = $1
        `, [batchId]);

        console.log(`📦 Batch Status: ${batchRes.rows[0].status}`);
        if (batchRes.rows[0].error_message) {
            console.log(`⚠️  Batch Error: ${batchRes.rows[0].error_message}\n`);
        }

        console.log(`\n💡 Posibles causas si no hay errores registrados:`);
        console.log(`   1. Gas insuficiente en relayers (verificado: tienen 0.042 MATIC ✅)`);
        console.log(`   2. Problema de nonce en relayers`);
        console.log(`   3. RPC rate limit o timeout`);
        console.log(`   4. Error en el código que no se está capturando correctamente\n`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkBatch329Errors();
