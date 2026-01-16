const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const addrSuffix = '136d714f'.toLowerCase();
        const fullAddr = '0x7363d49c0ef0ae66ba7907f42932c340136d714f'.toLowerCase();

        console.log(`🔎 Buscando dirección completa: ${fullAddr}`);
        console.log(`🔎 Buscando sufijo: ${addrSuffix}`);

        // Get all tables and columns that are strings
        const res = await pool.query(`
            SELECT table_name, column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND data_type IN ('character varying', 'text', 'character')
        `);

        for (const r of res.rows) {
            try {
                // Search for full address
                const fullMatch = await pool.query(`SELECT * FROM ${r.table_name} WHERE LOWER(${r.column_name}) = $1`, [fullAddr]);
                if (fullMatch.rows.length > 0) {
                    console.log(`✅ ¡COINCIDENCIA EXACTA hallada en ${r.table_name}.${r.column_name}!`);
                    console.table(fullMatch.rows);
                }

                // Search for suffix (catch typos or different formats)
                const suffixMatch = await pool.query(`SELECT * FROM ${r.table_name} WHERE LOWER(${r.column_name}) LIKE $1`, ['%' + addrSuffix]);
                if (suffixMatch.rows.length > 0 && fullMatch.rows.length === 0) {
                    console.log(`⚠️ Posible coincidencia (sufijo) en ${r.table_name}.${r.column_name}:`);
                    console.table(suffixMatch.rows);
                }
            } catch (e) {
                // Skip errors (e.g. columns that aren't actually strings despite data_type)
            }
        }

        console.log("\n--- Búsqueda finalizada ---");

    } catch (e) {
        console.error("❌ Error fatal:", e);
    } finally {
        pool.end();
    }
}
run();
