require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkRelayerBalances() {
    try {
        console.log('\n📊 Verificando balances en BD...\n');

        // Batch 325
        const batch325 = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_balance IS NOT NULL AND last_balance != '0') as with_balance,
                SUM(CAST(last_balance AS DECIMAL)) as total_balance
            FROM relayers
            WHERE batch_id = 325
        `);

        console.log('🔹 Batch 325:');
        console.log(`   Total relayers: ${batch325.rows[0].total}`);
        console.log(`   Con balance: ${batch325.rows[0].with_balance}`);
        console.log(`   Balance total (BD): ${batch325.rows[0].total_balance || 0} MATIC\n`);

        // Funder 0x05dac...
        const funderBatches = await pool.query(`
            SELECT id FROM batches 
            WHERE LOWER(funder_address) = LOWER('0x05dac55cc6fd7b84be32fd262ce4521eb6b29c38')
        `);

        const batchIds = funderBatches.rows.map(b => b.id);

        const funderRelayers = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_balance IS NOT NULL AND last_balance != '0') as with_balance,
                SUM(CAST(last_balance AS DECIMAL)) as total_balance
            FROM relayers
            WHERE batch_id = ANY($1)
        `, [batchIds]);

        console.log('🔹 Funder 0x05dac... (todos los batches):');
        console.log(`   Total relayers: ${funderRelayers.rows[0].total}`);
        console.log(`   Con balance: ${funderRelayers.rows[0].with_balance}`);
        console.log(`   Balance total (BD): ${funderRelayers.rows[0].total_balance || 0} MATIC\n`);

        // Detalle por batch
        const detailRes = await pool.query(`
            SELECT 
                r.batch_id,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE r.last_balance IS NOT NULL AND r.last_balance != '0') as with_balance,
                SUM(CAST(r.last_balance AS DECIMAL)) as total_balance
            FROM relayers r
            WHERE r.batch_id = ANY($1)
            GROUP BY r.batch_id
            ORDER BY r.batch_id
        `, [batchIds]);

        console.log('📋 Detalle por Batch:');
        detailRes.rows.forEach(row => {
            console.log(`   Batch ${row.batch_id}: ${row.with_balance}/${row.total} con balance (${row.total_balance || 0} MATIC)`);
        });

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkRelayerBalances();
