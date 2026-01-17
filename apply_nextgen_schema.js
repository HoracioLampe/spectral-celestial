const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres:RCTmFhXHkUdhrYQrbyYToUCLUjSMSzsP@crossover.proxy.rlwy.net:39205/railway';
const schemaPath = path.join(__dirname, 'schema.sql');

async function applyOriginalSchema() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Conectando a la base de datos...');
        await client.connect();

        console.log('Limpiando base de datos para asegurar una copia fiel...');
        await client.query(`
            DROP TABLE IF EXISTS batch_transactions CASCADE;
            DROP TABLE IF EXISTS batches CASCADE;
            DROP TABLE IF EXISTS faucets CASCADE;
            DROP TABLE IF EXISTS relayers CASCADE;
            DROP TABLE IF EXISTS rbac_users CASCADE;
            DROP TABLE IF EXISTS session CASCADE;
            DROP TABLE IF EXISTS sessions CASCADE;
            DROP TABLE IF EXISTS merkle_nodes CASCADE;
            DROP TABLE IF EXISTS users CASCADE;
            DROP TABLE IF EXISTS courses CASCADE;
            DROP TABLE IF EXISTS "HolaMundo" CASCADE;
        `);

        console.log('Leyendo schema.sql original...');
        let sql = fs.readFileSync(schemaPath, 'utf8');

        // Sanitización: Citar nombres de constraints que empiezan con números
        console.log('Sanitizando SQL...');
        sql = sql.replace(/CONSTRAINT (\d+_[^ \n\r,;]+)/g, 'CONSTRAINT "$1"');

        // Quitar sección de CHECK CONSTRAINTS porque da errores de sintaxis en PG16
        sql = sql.replace(/-- CHECK CONSTRAINTS[\s\S]*?-- INDEXES/, '-- INDEXES');

        console.log('Aplicando estructura de Next-Gen...');
        await client.query(sql);
        console.log('✅ Estructura original aplicada con éxito.');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

applyOriginalSchema();
