require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function investigateRBAC() {
    const client = await pool.connect();

    try {
        console.log('🔍 Investigando problema de RBAC...\n');

        // 1. Ver todas las wallets en rbac
        console.log('📋 Todas las wallets en tabla RBAC:');
        const allRbac = await client.query(`
      SELECT address, role, created_at 
      FROM rbac 
      ORDER BY created_at DESC;
    `);
        console.table(allRbac.rows);

        // 2. Buscar wallets con rol NULL
        console.log('\n⚠️  Wallets con rol NULL:');
        const nullRoles = await client.query(`
      SELECT address, role, created_at 
      FROM rbac 
      WHERE role IS NULL;
    `);
        console.table(nullRoles.rows);

        // 3. Ver si hay sesiones activas
        console.log('\n🔐 Sesiones activas (si existe tabla sessions):');
        try {
            const sessions = await client.query(`
        SELECT sess, expire 
        FROM sessions 
        WHERE expire > NOW() 
        LIMIT 5;
      `);
            console.log(`Total sesiones activas: ${sessions.rows.length}`);

            // Parsear sesiones para ver qué wallets tienen sesión
            sessions.rows.forEach((session, idx) => {
                try {
                    const sessData = session.sess;
                    if (sessData.user) {
                        console.log(`Sesión ${idx + 1}: Wallet ${sessData.user.address}, Rol: ${sessData.user.role}`);
                    }
                } catch (e) {
                    // Ignorar errores de parseo
                }
            });
        } catch (e) {
            console.log('No se pudo acceder a tabla sessions (puede no existir)');
        }

        // 4. Ver estructura de tabla rbac
        console.log('\n📊 Estructura de tabla RBAC:');
        const structure = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'rbac'
      ORDER BY ordinal_position;
    `);
        console.table(structure.rows);

        // 5. Verificar si hay constraints
        console.log('\n🔒 Constraints en tabla RBAC:');
        const constraints = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'rbac';
    `);
        console.table(constraints.rows);

        console.log('\n✅ Investigación completada!');
        console.log('\n💡 Recomendaciones:');
        console.log('1. Las wallets con rol NULL no deberían poder loguearse');
        console.log('2. Verifica el código de autenticación en server.js');
        console.log('3. Puede haber una sesión cacheada en el navegador');
        console.log('4. Limpia las cookies del navegador o usa modo incógnito');

    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

investigateRBAC().catch(console.error);
