
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log("📊 Auditing Faucet Key Status...");
    try {
        const res = await pool.query("SELECT id, address, private_key FROM faucets");
        res.rows.forEach(r => {
            console.log(` - ${r.id} | ${r.address} | PK: ${r.private_key ? r.private_key.substring(0, 10) + '...' : 'NULL'}`);
        });
    } catch (err) {
        console.error("❌ Audit failed:", err);
    } finally {
        await pool.end();
    }
}
run();
