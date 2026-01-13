const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const address = '0x7363d49c0ef0ae66ba7907f42932c340136d714f';

async function checkAddress() {
    try {
        console.log(`Buscando la dirección: ${address}...`);

        const res = await pool.query('SELECT * FROM faucets WHERE LOWER(funder_address) = LOWER($1)', [address]);

        if (res.rows.length > 0) {
            console.log("¡Encontrado en 'faucets' (como funder_address)!");
            console.table(res.rows);
            return res.rows[0];
        } else {
            console.log("No se encontró la dirección como 'funder_address' en la tabla 'faucets'.");

            // Check if it's in relayers maybe? 
            const relRes = await pool.query('SELECT * FROM relayers WHERE LOWER(address) = LOWER($1)', [address]);
            if (relRes.rows.length > 0) {
                console.log("Se encontró en la tabla 'relayers':");
                console.table(relRes.rows);
            } else {
                console.log("Tampoco se encontró en la tabla 'relayers'.");
            }
        }
    } catch (e) {
        console.error("Error ejecutando la query:", e);
    } finally {
        await pool.end();
    }
}

checkAddress();
