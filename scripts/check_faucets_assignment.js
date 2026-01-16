require('dotenv').config();
const { Pool } = require('pg');

async function checkFaucets() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('=== Checking Faucets in Database ===\n');

        // Get all faucets
        const allFaucets = await pool.query('SELECT address, funder_address FROM faucets ORDER BY id');

        console.log(`Total Faucets: ${allFaucets.rows.length}\n`);

        allFaucets.rows.forEach((f, idx) => {
            console.log(`${idx + 1}. Faucet: ${f.address}`);
            console.log(`   Funder: ${f.funder_address || 'NULL'}\n`);
        });

        // Check for the specific faucet mentioned
        const specificFaucet = await pool.query(
            'SELECT * FROM faucets WHERE address = $1',
            ['0x8Dd04f10017cc395F052d405354823b258343921']
        );

        if (specificFaucet.rows.length > 0) {
            console.log('=== Specific Faucet 0x8Dd04f... ===');
            console.log(`Funder Address: ${specificFaucet.rows[0].funder_address}`);
            console.log(`Created: ${specificFaucet.rows[0].created_at || 'N/A'}\n`);
        }

        // Check for duplicate funder_address
        const duplicates = await pool.query(`
            SELECT funder_address, COUNT(*) as count 
            FROM faucets 
            WHERE funder_address IS NOT NULL
            GROUP BY funder_address 
            HAVING COUNT(*) > 1
        `);

        if (duplicates.rows.length > 0) {
            console.log('⚠️  DUPLICATE FUNDER ADDRESSES FOUND:');
            duplicates.rows.forEach(d => {
                console.log(`   ${d.funder_address}: ${d.count} faucets`);
            });
        } else {
            console.log('✅ No duplicate funder addresses');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

checkFaucets();
