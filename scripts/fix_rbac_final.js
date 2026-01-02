const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function repair() {
    try {
        console.log('🔍 Starting rbac_users repair...');

        // 1. Ensure normalizing existing data to lowercase and trimmed
        await pool.query("UPDATE rbac_users SET address = LOWER(TRIM(address))");
        console.log('✅ Existing addresses normalized to lowercase.');

        // 2. Remove duplicates keeping only the one with the earliest created_at
        // Since there's no ID, we use ctid (internal postgres identifier) to distinguish rows
        await pool.query(`
            DELETE FROM rbac_users a USING rbac_users b
            WHERE a.ctid > b.ctid 
            AND a.address = b.address;
        `);
        console.log('✅ Duplicates removed.');

        // 3. Add UNIQUE constraint to address
        const constraintCheck = await pool.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'rbac_users' AND constraint_type = 'UNIQUE' AND constraint_name = 'unique_address';
        `);

        if (constraintCheck.rows.length === 0) {
            await pool.query('ALTER TABLE rbac_users ADD CONSTRAINT unique_address UNIQUE (address);');
            console.log('✅ Unique constraint added to address column.');
        } else {
            console.log('ℹ️ Unique constraint already exists.');
        }

    } catch (err) {
        console.error('❌ Error during repair:', err.message);
    } finally {
        await pool.end();
    }
}

repair();
