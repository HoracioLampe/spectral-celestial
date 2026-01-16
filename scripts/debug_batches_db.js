const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugBatches() {
    const client = await pool.connect();
    try {
        const batchId = process.argv[2];
        if (batchId) {
            console.log(`🔍 Inspecting Transactions for Batch ID: ${batchId}...`);
            const txRes = await client.query(`
                SELECT id, wallet_address_to, amount_usdc, status, tx_hash 
                FROM batch_transactions 
                WHERE batch_id = $1
            `, [batchId]);

            if (txRes.rows.length === 0) {
                console.log("⚠️ No transactions found for this batch.");
            } else {
                const total = txRes.rows.length;
                const pending = txRes.rows.filter(t => t.status === 'PENDING').length;
                const completed = txRes.rows.filter(t => t.status === 'COMPLETED').length;
                const failed = txRes.rows.filter(t => t.status === 'FAILED').length;

                console.log(`📊 Batch ${batchId} Summary: Total=${total} | Pending=${pending} | Completed=${completed} | Failed=${failed}`);
                console.log("Sample Txs:");
                txRes.rows.slice(0, 5).forEach(t => console.log(t));

                // Check invalid addresses
                const invalid = txRes.rows.filter(t => !t.wallet_address_to || !t.wallet_address_to.startsWith('0x'));
                if (invalid.length > 0) {
                    console.log("⚠️ FOUND INVALID ADDRESSES:", invalid.length);
                    console.log(invalid[0]);
                }
            }
        } else {
            console.log("🔍 Inspecting Batches Table Addresses (Top 20)...");
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
                    const isLower = addr ? addr === addr.toLowerCase() : false;
                    const hasSpace = addr ? addr !== addr.trim() : false;
                    console.log(`[ID: ${r.id}] Address: '${addr}' | Lowercase? ${isLower} | Spaces? ${hasSpace}`);
                });
            }
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
