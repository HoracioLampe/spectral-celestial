
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("🛠️ Migrando BD: Agregando columna 'metrics'...");
        await pool.query(`
            ALTER TABLE batches 
            ADD COLUMN IF NOT EXISTS metrics JSONB DEFAULT '{}';
        `);
        console.log("✅ Columna 'metrics' agregada con éxito.");
    } catch (e) {
        console.error("❌ Error migración:", e.message);
    } finally {
        pool.end();
    }
}

migrate();
