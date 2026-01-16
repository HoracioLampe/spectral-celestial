require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
    try {
        console.log("--- Faucets Columns ---");
        const f = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'faucets'");
        console.log(f.rows.map(r => r.column_name).join(', '));

        console.log("\n--- Relayers Columns ---");
        const r = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'relayers'");
        console.log(r.rows.map(r => r.column_name).join(', '));

        console.log("\n--- Audit Mapping ---");
        const audit = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(f.address) as with_faucet,
                COUNT(*) - COUNT(f.address) as without_faucet
            FROM relayers r
            LEFT JOIN batches b ON r.batch_id = b.id
            LEFT JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
            WHERE r.status != 'drained'
        `);
        console.log(JSON.stringify(audit.rows, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
checkSchema();
