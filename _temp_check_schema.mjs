// _temp_check_schema.mjs
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
    const tables = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('Tables:', tables.rows.map(r => r.table_name).join(', '));

    // Check if there's a table with wallet/private key columns
    for (const { table_name } of tables.rows) {
        const cols = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
        `, [table_name]);
        const colNames = cols.rows.map(r => r.column_name).join(', ');
        if (colNames.includes('private') || colNames.includes('encrypted') || colNames.includes('address')) {
            console.log(`  [${table_name}]: ${colNames}`);
        }
    }
} catch (err) {
    console.error('[!]', err.message);
} finally {
    await pool.end();
    process.exit(0);
}
