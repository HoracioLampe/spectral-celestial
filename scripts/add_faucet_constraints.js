// Script to add UNIQUE constraint and index to faucets table
const { Pool } = require('pg');

async function addFaucetConstraints() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('🔗 Connecting to database...');

        // 1. Add UNIQUE constraint
        console.log('\n📋 Step 1: Adding UNIQUE constraint on funder_address...');
        try {
            await pool.query(`
                ALTER TABLE faucets 
                ADD CONSTRAINT faucets_funder_address_unique 
                UNIQUE (funder_address)
            `);
            console.log('✅ UNIQUE constraint added successfully');
        } catch (e) {
            if (e.message.includes('already exists')) {
                console.log('⚠️  UNIQUE constraint already exists (skipped)');
            } else {
                throw e;
            }
        }

        // 2. Create index
        console.log('\n📋 Step 2: Creating optimized index...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_faucets_funder_address_lower 
            ON faucets (LOWER(funder_address))
        `);
        console.log('✅ Index created successfully');

        // 3. Verify no duplicates
        console.log('\n📋 Step 3: Checking for duplicate funders...');
        const duplicates = await pool.query(`
            SELECT funder_address, COUNT(*) as count
            FROM faucets
            GROUP BY funder_address
            HAVING COUNT(*) > 1
        `);

        if (duplicates.rows.length === 0) {
            console.log('✅ No duplicates found - database is clean!');
        } else {
            console.log(`⚠️  Found ${duplicates.rows.length} duplicate funder(s):`);
            duplicates.rows.forEach(row => {
                console.log(`   - ${row.funder_address}: ${row.count} entries`);
            });
        }

        console.log('\n🎉 All constraints applied successfully!');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

addFaucetConstraints();
