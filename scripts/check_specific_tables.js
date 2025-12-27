const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway",
});

async function checkSchema() {
    const client = await pool.connect();
    try {
        const tables = ['batches', 'batch_transactions'];

        for (const table of tables) {
            console.log(`\n--- Columns in '${table}' ---`);
            const colsRes = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table]);
            colsRes.rows.forEach(c => console.log(` - ${c.column_name} (${c.data_type})`));
        }

    } catch (err) {
        console.error("Error checking schema:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkSchema();
