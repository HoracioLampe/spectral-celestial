// Script para ejecutar el UPDATE de batch 519
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function updateBatch519() {
    try {
        console.log('🔄 Conectando a la base de datos...');

        // Primero verificar cuántos registros hay
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM batch_transactions WHERE batch_id = 519'
        );
        console.log(`📊 Registros a actualizar: ${countResult.rows[0].count}`);

        // Ejecutar el UPDATE
        console.log('⚡ Ejecutando UPDATE...');
        const updateResult = await pool.query(`
            UPDATE batch_transactions
            SET 
                amount_usdc = floor(random() * (200000000 - 1000000 + 1) + 1000000)::bigint,
                amount_transferred = floor(random() * (200000000 - 1000000 + 1) + 1000000)::text
            WHERE batch_id = 519
        `);

        console.log(`✅ UPDATE completado: ${updateResult.rowCount} registros actualizados`);

        // Mostrar algunos ejemplos
        const sampleResult = await pool.query(`
            SELECT id, wallet_address_to, amount_usdc, amount_transferred 
            FROM batch_transactions 
            WHERE batch_id = 519 
            ORDER BY id 
            LIMIT 5
        `);

        console.log('\n📋 Muestra de registros actualizados:');
        sampleResult.rows.forEach(row => {
            console.log(`  ID ${row.id}: amount_usdc=${row.amount_usdc} (${(row.amount_usdc / 1000000).toFixed(2)} USDC), amount_transferred=${row.amount_transferred}`);
        });

        await pool.end();
        console.log('\n✅ Script completado exitosamente');

    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

updateBatch519();
