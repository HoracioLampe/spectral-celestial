const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway",
});

async function checkSchema() {
    const client = await pool.connect();
    try {
        console.log("Checking DB Tables...");
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log("Tables found:", tablesRes.rows.map(r => r.table_name).join(", "));

        for (const table of tablesRes.rows) {
            const colsRes = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [table.table_name]);
            console.log(`\nColumns in '${table.table_name}':`);
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
