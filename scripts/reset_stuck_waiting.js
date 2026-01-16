require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkStuckTransactions() {
    try {
        console.log('\n🔍 Verificando transacciones atascadas...\n');

        // Check WAITING_CONFIRMATION without tx_hash
        const waitingRes = await pool.query(`
            SELECT 
                batch_id,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE tx_hash IS NULL) as without_hash,
                COUNT(*) FILTER (WHERE tx_hash IS NOT NULL) as with_hash
            FROM batch_transactions
            WHERE status = 'WAITING_CONFIRMATION'
            GROUP BY batch_id
            ORDER BY batch_id DESC
            LIMIT 10
        `);

        console.log('📊 Transacciones en WAITING_CONFIRMATION:');
        console.log('─────────────────────────────────────────');

        if (waitingRes.rows.length === 0) {
            console.log('✅ No hay transacciones en WAITING_CONFIRMATION\n');
        } else {
            waitingRes.rows.forEach(row => {
                console.log(`Batch ${row.batch_id}:`);
                console.log(`  Total: ${row.total}`);
                console.log(`  Sin tx_hash: ${row.without_hash} ⚠️`);
                console.log(`  Con tx_hash: ${row.with_hash}`);
                console.log('');
            });
        }

        // Reset those without tx_hash
        const resetRes = await pool.query(`
            UPDATE batch_transactions
            SET status = 'PENDING'
            WHERE status = 'WAITING_CONFIRMATION'
            AND tx_hash IS NULL
            RETURNING batch_id
        `);

        if (resetRes.rowCount > 0) {
            console.log(`✅ ${resetRes.rowCount} transacciones reseteadas a PENDING\n`);

            // Group by batch
            const batches = {};
            resetRes.rows.forEach(row => {
                batches[row.batch_id] = (batches[row.batch_id] || 0) + 1;
            });

            console.log('Por batch:');
            Object.entries(batches).forEach(([batchId, count]) => {
                console.log(`  Batch ${batchId}: ${count} transacciones`);
            });
        } else {
            console.log('✅ No hay transacciones para resetear\n');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkStuckTransactions();
