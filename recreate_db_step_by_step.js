const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres:RCTmFhXHkUdhrYQrbyYToUCLUjSMSzsP@crossover.proxy.rlwy.net:39205/railway';
const schemaPath = path.join(__dirname, 'schema.sql');

async function recreateDatabase() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('--- RECREACIÓN PASO A PASO ---');

        console.log('Borrando esquema público...');
        await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

        console.log('Leyendo schema.sql...');
        let sql = fs.readFileSync(schemaPath, 'utf8');

        // El problema es el orden en el archivo exportado y las comillas en HolaMundo_id_seq
        // Vamos a limpiar el SQL de comentarios y dividirlo inteligentemente
        const statements = sql
            .replace(/--.*$/gm, '') // Quitar comentarios
            .replace(/CONSTRAINT (\d+_[^ \n\r,;]+)/g, 'CONSTRAINT "$1"') // Citar constraints numéricos
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.includes('-- CHECK CONSTRAINTS'));

        console.log(`Ejecutando ${statements.length} sentencias...`);

        for (let statement of statements) {
            try {
                // Pequeño fix para el nombre de la secuencia con comillas que causa error
                const sanitizedStatement = statement.replace('nextval(\'"HolaMundo_id_seq"\'::regclass)', 'nextval(\'holamundo_id_seq\'::regclass)');
                await client.query(sanitizedStatement);
            } catch (err) {
                // Ignorar errores de indices/constraints si la tabla no existe o similar por ahora
                console.warn(`⚠️ Sentencia fallida: ${statement.substring(0, 50)}...`);
                console.warn(`   Error: ${err.message}`);
            }
        }

        console.log('✅ Proceso finalizado.');

        const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
        console.log('\nTablas creadas:');
        res.rows.forEach(row => console.log(`- ${row.table_name}`));

    } catch (err) {
        console.error('❌ ERROR FATAL:', err.message);
    } finally {
        await client.end();
    }
}

recreateDatabase();
