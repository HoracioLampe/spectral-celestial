require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function fixRBAC() {
    const client = await pool.connect();

    try {
        console.log('🔍 Verificando y arreglando RBAC...\n');

        // 1. Verificar si existe la tabla rbac_users
        console.log('📋 Verificando tabla rbac_users...');
        const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'rbac_users'
      );
    `);

        if (!tableExists.rows[0].exists) {
            console.log('⚠️  Tabla rbac_users NO existe. Creándola...');
            await client.query(`
        CREATE TABLE rbac_users (
          address character varying(42) NOT NULL,
          role character varying(20) DEFAULT 'OPERATOR'::character varying,
          name character varying(100),
          created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (address)
        );
      `);
            console.log('✅ Tabla rbac_users creada');
        } else {
            console.log('✅ Tabla rbac_users existe');
        }

        // 2. Ver todas las wallets en rbac_users
        console.log('\n📋 Wallets en rbac_users:');
        const allUsers = await client.query(`
      SELECT address, role, name, created_at 
      FROM rbac_users 
      ORDER BY created_at DESC;
    `);
        console.table(allUsers.rows);

        // 3. Ver wallets con rol NULL
        console.log('\n⚠️  Wallets con rol NULL:');
        const nullRoles = await client.query(`
      SELECT address, role, created_at 
      FROM rbac_users 
      WHERE role IS NULL;
    `);

        if (nullRoles.rows.length > 0) {
            console.table(nullRoles.rows);

            console.log('\n🔧 Arreglando wallets con rol NULL...');
            for (const user of nullRoles.rows) {
                await client.query(`
          UPDATE rbac_users 
          SET role = 'OPERATOR' 
          WHERE address = $1;
        `, [user.address]);
                console.log(`✅ Actualizado ${user.address} → OPERATOR`);
            }
        } else {
            console.log('✅ No hay wallets con rol NULL');
        }

        // 4. Ver todas las wallets después del fix
        console.log('\n📋 Estado final de rbac_users:');
        const finalUsers = await client.query(`
      SELECT address, role, name, created_at 
      FROM rbac_users 
      ORDER BY created_at DESC;
    `);
        console.table(finalUsers.rows);

        // 5. Verificar sesiones activas
        console.log('\n🔐 Verificando sesiones activas...');
        try {
            const sessions = await client.query(`
        SELECT COUNT(*) as total
        FROM session 
        WHERE expire > NOW();
      `);
            console.log(`Total sesiones activas: ${sessions.rows[0].total}`);

            if (sessions.rows[0].total > 0) {
                console.log('\n💡 Recomendación: Limpia las sesiones antiguas o haz logout/login');
            }
        } catch (e) {
            console.log('No se pudo verificar sesiones');
        }

        console.log('\n✅ RBAC arreglado!');
        console.log('\n📝 Próximos pasos:');
        console.log('1. Haz logout en la aplicación');
        console.log('2. Limpia las cookies del navegador');
        console.log('3. Vuelve a hacer login');
        console.log('4. El sistema debería verificar el rol correctamente');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

fixRBAC().catch(console.error);
