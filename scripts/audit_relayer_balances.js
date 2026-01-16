const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function audit() {
    try {
        console.log("📊 Starting Relayer Balance Audit...");

        // Count total relayers
        const total = await pool.query('SELECT COUNT(*) FROM relayers');
        console.log(`Total Relayers: ${total.rows[0].count}`);

        // Count drained relayers
        const drained = await pool.query("SELECT COUNT(*) FROM relayers WHERE status = 'drained'");
        console.log(`Marked as 'drained': ${drained.rows[0].count}`);

        // Find stuck relayers (Balance > 0.2 and NOT drained/active)
        // We use string comparison for simplicity on numeric/varchar fields if standard numeric fails
        const res = await pool.query(`
            SELECT address, last_balance, batch_id 
            FROM relayers 
            WHERE status != 'drained' 
            ORDER BY id DESC
        `);

        let stuckCount = 0;
        let pendingScan = 0;

        console.log("\n--- Audit Details ---");
        for (const r of res.rows) {
            const bal = parseFloat(r.last_balance || "0");
            if (bal > 0.2) {
                console.log(`⚠️ Stuck Funds: ${r.address.substring(0, 8)}.. | Balance: ${bal} | Batch: ${r.batch_id}`);
                stuckCount++;
            } else {
                pendingScan++; // Likely small dust or 0 but not marked drained yet
            }
        }

        console.log("\n--- Summary ---");
        console.log(`✅ Fully Drained (DB Status): ${drained.rows[0].count}`);
        console.log(`🚨 Significant Balance Remaining (> 0.2): ${stuckCount}`);
        console.log(`💤 Dust/Zero but unflagged: ${pendingScan}`);

        if (stuckCount === 0) {
            console.log("\n✨ CONCLUSION: SYSTEM CLEAN. No significant funds stranded.");
        } else {
            console.log("\n⚠️ CONCLUSION: Some funds remain. Rescue script likely still running or missed items.");
        }

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

audit();
