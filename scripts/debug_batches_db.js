const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugBatches() {
    const client = await pool.connect();
    try {
        console.log("🔍 Inspecting Batches Table Addresses...");

        const res = await client.query(`
            SELECT id, funder_address, batch_number, created_at 
            FROM batches 
            ORDER BY created_at DESC 
            LIMIT 20
        `);

        if (res.rows.length === 0) {
            console.log("⚠️ No batches found in DB.");
        } else {
            console.log("Found Batches:");
            res.rows.forEach(r => {
                const addr = r.funder_address;
                const isLower = addr === addr.toLowerCase();
                const hasSpace = addr !== addr.trim();
                console.log(`[ID: ${r.id}] Address: '${addr}' | Lowercase? ${isLower} | Spaces? ${hasSpace}`);
            });
        }

        // Check for specific problematic address if known (or just general stats)
        const stats = await client.query(`SELECT COUNT(*) FROM batches`);
        console.log(`Total Batches in DB: ${stats.rows[0].count}`);

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

debugBatches();
