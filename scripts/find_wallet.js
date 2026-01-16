require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function findWallet() {
    try {
        const address = '0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5';

        console.log(`\n🔍 Buscando wallet: ${address}\n`);

        // Check in faucets
        const faucetRes = await pool.query(`
            SELECT * FROM faucets WHERE LOWER(address) = LOWER($1)
        `, [address]);

        if (faucetRes.rows.length > 0) {
            console.log('✅ Encontrada en FAUCETS:');
            console.log(faucetRes.rows[0]);
        }

        // Check in relayers
        const relayerRes = await pool.query(`
            SELECT * FROM relayers WHERE LOWER(address) = LOWER($1)
        `, [address]);

        if (relayerRes.rows.length > 0) {
            console.log('\n✅ Encontrada en RELAYERS:');
            console.log(relayerRes.rows[0]);
        }

        // Check as funder
        const batchRes = await pool.query(`
            SELECT * FROM batches WHERE LOWER(funder_address) = LOWER($1)
        `, [address]);

        if (batchRes.rows.length > 0) {
            console.log('\n✅ Encontrada como FUNDER en BATCHES:');
            console.log(`Total batches: ${batchRes.rows.length}`);
            batchRes.rows.forEach(b => {
                console.log(`  - Batch ${b.id}: ${b.batch_name || 'Sin nombre'} (${b.status})`);
            });
        }

        if (faucetRes.rows.length === 0 && relayerRes.rows.length === 0 && batchRes.rows.length === 0) {
            console.log('❌ Wallet NO encontrada en la base de datos');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

findWallet();
