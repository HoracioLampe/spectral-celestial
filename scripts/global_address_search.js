const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const searchAddress = '0x7363d49c0ef0ae66ba7907f42932c340136d714f'.toLowerCase();

async function globalSearch() {
    try {
        console.log(`🔎 Iniciando búsqueda global para: ${searchAddress}`);

        // 1. Faucets
        const faucets = await pool.query('SELECT * FROM faucets WHERE LOWER(address) = $1 OR LOWER(funder_address) = $1', [searchAddress]);
        console.log(`\n--- Tabla: faucets ---`);
        if (faucets.rows.length > 0) console.table(faucets.rows);
        else console.log("No se encontraron coincidencias.");

        // 2. Relayers
        const relayers = await pool.query('SELECT * FROM relayers WHERE LOWER(address) = $1', [searchAddress]);
        console.log(`\n--- Tabla: relayers ---`);
        if (relayers.rows.length > 0) console.table(relayers.rows);
        else console.log("No se encontraron coincidencias.");

        // 3. Batches (funder_address)
        const batches = await pool.query('SELECT id, status, funder_address FROM batches WHERE LOWER(funder_address) = $1', [searchAddress]);
        console.log(`\n--- Tabla: batches (funder_address) ---`);
        if (batches.rows.length > 0) console.table(batches.rows);
        else console.log("No se encontraron coincidencias.");

        // 4. Batches (como parte de relayer_addresses JSON)
        // Note: this depends on the structure of the column, usually it's a JSON array or CSV
        const batchesRelayers = await pool.query("SELECT id, status FROM batches WHERE relayer_addresses::text ILIKE $1", [`%${searchAddress}%`]);
        console.log(`\n--- Tabla: batches (relayer_addresses) ---`);
        if (batchesRelayers.rows.length > 0) console.table(batchesRelayers.rows);
        else console.log("No se encontraron coincidencias.");

        // 5. Total de Faucets para referencia
        const totalFaucets = await pool.query('SELECT COUNT(*) FROM faucets');
        console.log(`\nTotal de faucets en DB: ${totalFaucets.rows[0].count}`);

    } catch (e) {
        console.error("❌ Error en la búsqueda:", e);
    } finally {
        await pool.end();
    }
}

globalSearch();
