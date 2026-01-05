require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function markBatchAsDrained() {
    try {
        const batchIds = [324, 327]; // Batches ya recuperados

        console.log('\n🔄 Marcando relayers como drenados...\n');

        for (const batchId of batchIds) {
            const result = await pool.query(`
                UPDATE relayers 
                SET last_balance = '0'
                WHERE batch_id = $1 
                AND (last_balance IS NULL OR last_balance != '0')
            `, [batchId]);

            console.log(`✅ Batch ${batchId}: ${result.rowCount} relayers marcados como drenados`);
        }

        console.log('\n✅ Actualización completada\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

markBatchAsDrained();
