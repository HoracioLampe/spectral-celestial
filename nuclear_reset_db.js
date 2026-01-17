const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres:RCTmFhXHkUdhrYQrbyYToUCLUjSMSzsP@crossover.proxy.rlwy.net:39205/railway';
const schemaPath = path.join(__dirname, 'schema.sql');

async function resetDatabase() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('CONNECTED - Starting total database reset...');

        // 1. DROP EVERYTHING
        console.log('Dropping all existing tables and sequences...');
        await client.query(`
            DROP SCHEMA public CASCADE;
            CREATE SCHEMA public;
            GRANT ALL ON SCHEMA public TO postgres;
            GRANT ALL ON SCHEMA public TO public;
        `);
        console.log('✅ Database is now EMPTY.');

        // 2. READ AND CLEAN SCHEMA.SQL
        console.log('Reading schema.sql...');
        let sql = fs.readFileSync(schemaPath, 'utf8');

        // Sanitización para PostgreSQL moderno
        console.log('Sanitizing SQL...');
        // 1. Quitar la sección completa de CHECK CONSTRAINTS que da problemas
        sql = sql.replace(/-- CHECK CONSTRAINTS[\s\S]*?-- INDEXES/, '-- INDEXES');

        // 2. Por si acaso, citar cualquier constraint numérico que quede
        sql = sql.replace(/CONSTRAINT (\d+_[^ \n\r,;]+)/g, 'CONSTRAINT "$1"');

        console.log('Applying original Next-Gen structure (statement by statement)...');

        // Dividir el SQL por punto y coma, pero ignorando los que están dentro de comillas o triggers
        // Para este caso, el schema.sql es simple, podemos dividir por ";" seguido de nueva línea
        const statements = sql.split(/;[\r\n]+/);

        for (let statement of statements) {
            const trimmed = statement.trim();
            if (trimmed && !trimmed.startsWith('--')) {
                try {
                    await client.query(trimmed);
                } catch (err) {
                    console.warn(`⚠️ Warning on statement: ${trimmed.substring(0, 50)}...`);
                    console.warn(`   Reason: ${err.message}`);
                }
            }
        }
        console.log('✅ Structure application finished.');

        // 3. VERIFY
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        console.log('\nTables created:');
        res.rows.forEach(row => console.log(`- ${row.table_name}`));

    } catch (err) {
        console.error('❌ Error during reset:', err.message);
        if (err.stack) console.error(err.stack);
    } finally {
        await client.end();
    }
}

resetDatabase();
