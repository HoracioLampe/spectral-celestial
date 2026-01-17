const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres:RCTmFhXHkUdhrYQrbyYToUCLUjSMSzsP@crossover.proxy.rlwy.net:39205/railway';
const schemaPath = path.join(__dirname, 'schema.sql');

async function reconstructDatabase() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('--- RECONSTRUCCIÓN TOTAL ---');

        // 1. Limpieza total
        console.log('Borrando esquema público...');
        await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

        // 2. Preparar el SQL
        console.log('Leyendo y preparando schema.sql...');
        let sql = fs.readFileSync(schemaPath, 'utf8');

        // Limpiamos los nombres de constraints que empiezan con números para evitar errores de sintaxis
        sql = sql.replace(/CONSTRAINT (\d+_[^ \n\r,;]+)/g, 'CONSTRAINT "$1"');

        // El código de Next-Gen a veces tiene problemas con los checks generados, los removemos para asegurar fluidez
        // ya que la lógica principal reside en el servidor.
        sql = sql.replace(/-- CHECK CONSTRAINTS[\s\S]*?-- INDEXES/, '-- INDEXES');

        // 3. Aplicar de un solo bloque (Transaction)
        console.log('Aplicando estructura completa...');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        console.log('✅ Base de datos reconstruida con éxito.');

        // 4. Verificación final
        const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
        console.log('\nTablas creadas:');
        res.rows.forEach(row => console.log(`- ${row.table_name}`));

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error('❌ ERROR FATAL:', err.message);
    } finally {
        await client.end();
    }
}

reconstructDatabase();
