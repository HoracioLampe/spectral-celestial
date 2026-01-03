require('dotenv').config();
const { Pool } = require('pg');

async function dryRunRescue() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const querySelect = `
            SELECT 
                r.address as relayer, 
                f.address as faucet_target,
                b.funder_address as funder
            FROM relayers r
            LEFT JOIN batches b ON r.batch_id = b.id
            LEFT JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
            WHERE r.status != 'drained'
        `;

        const res = await pool.query(querySelect);
        console.log(`🔍 Checking ${res.rows.length} relayers...`);

        const summary = {};
        res.rows.forEach(row => {
            const target = row.faucet_target || "NULL (MISSING FAUCET)";
            summary[target] = (summary[target] || 0) + 1;
        });

        console.log("\n--- Target Distribution ---");
        console.log(JSON.stringify(summary, null, 2));

        if (summary["NULL (MISSING FAUCET)"]) {
            console.log("\n⚠️ RELAYERS WITHOUT TARGET FAUCET:");
            console.log(res.rows.filter(r => !r.faucet_target).slice(0, 5));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
dryRunRescue();
