require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function dropTable() {
    try {
        console.log("🧨 Eliminando tabla 'transactions'...");
        await pool.query("DROP TABLE IF EXISTS transactions");
        console.log("✅ Tabla 'transactions' eliminada correctamente.");
    } catch (err) {
        console.error("❌ Error borrando tabla:", err);
    } finally {
        await pool.end();
    }
}

dropTable();
