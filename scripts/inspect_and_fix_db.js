require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function inspectAndFixTables() {
    const client = await pool.connect();

    try {
        console.log('🔍 Conectando a la base de datos...\n');

        // 1. Verificar estructura de tabla faucets
        console.log('📋 Estructura de tabla FAUCETS:');
        const faucetsColumns = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'faucets'
      ORDER BY ordinal_position;
    `);
        console.table(faucetsColumns.rows);

        // 2. Verificar estructura de tabla relayers
        console.log('\n📋 Estructura de tabla RELAYERS:');
        const relayersColumns = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'relayers'
      ORDER BY ordinal_position;
    `);
        console.table(relayersColumns.rows);

        // 3. Verificar si existe columna encrypted_key en faucets
        const faucetHasEncrypted = faucetsColumns.rows.some(col => col.column_name === 'encrypted_key');
        console.log(`\n✅ Faucets tiene columna 'encrypted_key': ${faucetHasEncrypted}`);

        // 4. Verificar si existe columna encrypted_key en relayers
        const relayerHasEncrypted = relayersColumns.rows.some(col => col.column_name === 'encrypted_key');
        console.log(`✅ Relayers tiene columna 'encrypted_key': ${relayerHasEncrypted}`);

        // 5. Agregar columna encrypted_key a faucets si no existe
        if (!faucetHasEncrypted) {
            console.log('\n🔧 Agregando columna encrypted_key a tabla faucets...');
            await client.query(`
        ALTER TABLE faucets 
        ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
      `);
            console.log('✅ Columna encrypted_key agregada a faucets');
        }

        // 6. Agregar columna encrypted_key a relayers si no existe
        if (!relayerHasEncrypted) {
            console.log('\n🔧 Agregando columna encrypted_key a tabla relayers...');
            await client.query(`
        ALTER TABLE relayers 
        ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
      `);
            console.log('✅ Columna encrypted_key agregada a relayers');
        }

        // 7. Verificar si existe columna private_key (legacy)
        const faucetHasPrivateKey = faucetsColumns.rows.some(col => col.column_name === 'private_key');
        const relayerHasPrivateKey = relayersColumns.rows.some(col => col.column_name === 'private_key');

        console.log(`\n⚠️  Faucets tiene columna 'private_key' (legacy): ${faucetHasPrivateKey}`);
        console.log(`⚠️  Relayers tiene columna 'private_key' (legacy): ${relayerHasPrivateKey}`);

        // 8. Contar registros
        const faucetCount = await client.query('SELECT COUNT(*) FROM faucets');
        const relayerCount = await client.query('SELECT COUNT(*) FROM relayers');

        console.log(`\n📊 Total de faucets: ${faucetCount.rows[0].count}`);
        console.log(`📊 Total de relayers: ${relayerCount.rows[0].count}`);

        // 9. Verificar cuántos tienen encrypted_key
        if (faucetHasEncrypted) {
            const encryptedFaucets = await client.query('SELECT COUNT(*) FROM faucets WHERE encrypted_key IS NOT NULL AND encrypted_key != \'\'');
            console.log(`📊 Faucets con encrypted_key: ${encryptedFaucets.rows[0].count}`);
        }

        if (relayerHasEncrypted) {
            const encryptedRelayers = await client.query('SELECT COUNT(*) FROM relayers WHERE encrypted_key IS NOT NULL AND encrypted_key != \'\'');
            console.log(`📊 Relayers con encrypted_key: ${encryptedRelayers.rows[0].count}`);
        }

        console.log('\n✅ Inspección completada!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

inspectAndFixTables().catch(console.error);
