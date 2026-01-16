const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("Starting Facuet User-Link Migration...");

        // 1. Add Column
        console.log("Adding funder_address column...");
        await pool.query(`
            ALTER TABLE faucets 
            ADD COLUMN IF NOT EXISTS funder_address VARCHAR(42);
        `);

        // 2. Get First RBAC User
        console.log("Fetching first RBAC user...");
        const userRes = await pool.query('SELECT address FROM rbac_users ORDER BY created_at ASC LIMIT 1');

        if (userRes.rows.length === 0) {
            console.warn("⚠️ No RBAC Users found. Existing faucet will remain unassigned.");
        } else {
            const firstUser = userRes.rows[0].address;
            console.log(`Assigning existing faucets to: ${firstUser}`);

            // 3. Update Existing
            await pool.query('UPDATE faucets SET funder_address = $1 WHERE funder_address IS NULL', [firstUser]);
            console.log("✅ Existing faucets updated.");
        }

        // 4. Verify
        const res = await pool.query('SELECT * FROM faucets');
        console.log("Current Faucets:", res.rows);

    } catch (e) {
        console.error("Migration Failed:", e);
    } finally {
        await pool.end();
    }
}

migrate();
