const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function repair() {
    try {
        console.log('🔍 Checking for duplicate users...');

        // 1. Create the table if it's missing (failsafe)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rbac_users (
                id SERIAL PRIMARY KEY,
                address VARCHAR(42) NOT NULL,
                role VARCHAR(20) NOT NULL
            );
        `);

        // 2. Remove duplicates keeping only one entry per address
        // We'll keep the one with the smallest ID (usually the first one registered)
        // or we could sort by role precedence if needed. 
        await pool.query(`
            DELETE FROM rbac_users a USING rbac_users b
            WHERE a.id > b.id AND a.address = b.address;
        `);
        console.log('✅ Duplicates removed.');

        // 3. Add UNIQUE constraint to address
        // We check if it exists first to avoid error
        const constraintCheck = await pool.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'rbac_users' AND constraint_type = 'UNIQUE';
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
