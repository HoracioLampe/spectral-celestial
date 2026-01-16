const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway",
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("Restaurando tabla 'transactions'...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                tx_hash VARCHAR(66) UNIQUE NOT NULL,
                from_address VARCHAR(42) NOT NULL,
                to_address VARCHAR(42) NOT NULL,
                amount NUMERIC NOT NULL,
                gas_used NUMERIC,
                timestamp TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✅ Tabla 'transactions' creada/verificada.");
    } catch (err) {
        console.error("❌ Error en migración:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
