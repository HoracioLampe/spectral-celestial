const { Client } = require('pg');

const connectionString = 'postgresql://postgres:RCTmFhXHkUdhrYQrbyYToUCLUjSMSzsP@crossover.proxy.rlwy.net:39205/railway';

async function finalCleanup() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('--- FINAL CLEANUP ---');

        // Eliminar tablas de prueba
        console.log('Eliminando tablas "HolaMundo", "courses" y "users"...');
        await client.query('DROP TABLE IF EXISTS "HolaMundo" CASCADE;');
        await client.query('DROP SEQUENCE IF EXISTS "HolaMundo_id_seq" CASCADE;');
        await client.query('DROP TABLE IF EXISTS "courses" CASCADE;');
        await client.query('DROP TABLE IF EXISTS "users" CASCADE;');

        // Activar extensión necesaria para los índices de búsqueda
        console.log('Activando extensión pg_trgm...');
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

        // Re-ejecutar los índices que fallaron por falta de pg_trgm
        console.log('Re-creando índices de búsqueda...');
        await client.query('CREATE INDEX IF NOT EXISTS idx_batches_desc_trgm ON batches USING gin (description gin_trgm_ops);');
        await client.query('CREATE INDEX IF NOT EXISTS idx_batches_detail_trgm ON batches USING gin (detail gin_trgm_ops);');
        await client.query('CREATE INDEX IF NOT EXISTS idx_batches_number_trgm ON batches USING gin (batch_number gin_trgm_ops);');

        console.log('✅ Base de datos limpia e idéntica a Next-Gen funcional.');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

finalCleanup();
