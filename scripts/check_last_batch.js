require('dotenv').config();
const { Pool } = require('pg');

async function checkLastBatch() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('=== Checking Last Batch ===\n');

        // Get last batch
        const batchRes = await pool.query(`
            SELECT id, batch_number, status, total_transactions, funder_address, 
                   merkle_root, created_at, start_time, end_time
            FROM batches 
            ORDER BY id DESC 
            LIMIT 1
        `);

        if (batchRes.rows.length === 0) {
            console.log('No batches found');
            return;
        }

        const batch = batchRes.rows[0];
        console.log(`Batch ID: ${batch.id}`);
        console.log(`Batch Number: ${batch.batch_number}`);
        console.log(`Status: ${batch.status}`);
        console.log(`Total Transactions: ${batch.total_transactions}`);
        console.log(`Funder: ${batch.funder_address}`);
        console.log(`Merkle Root: ${batch.merkle_root || 'NOT SET'}`);
        console.log(`Created: ${batch.created_at}`);
        console.log(`Started: ${batch.start_time || 'NOT STARTED'}`);
        console.log(`Ended: ${batch.end_time || 'NOT ENDED'}\n`);

        // Get transaction stats
        const statsRes = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM batch_transactions
            WHERE batch_id = $1
            GROUP BY status
        `, [batch.id]);

        console.log('Transaction Stats:');
        statsRes.rows.forEach(row => {
            console.log(`  ${row.status}: ${row.count}`);
        });

        // Get relayer stats
        const relayerRes = await pool.query(`
            SELECT COUNT(*) as count, status
            FROM relayers
            WHERE batch_id = $1
            GROUP BY status
        `, [batch.id]);

        console.log('\nRelayer Stats:');
        relayerRes.rows.forEach(row => {
            console.log(`  ${row.status}: ${row.count}`);
        });

        // Check if there are pending transactions
        const pendingRes = await pool.query(`
            SELECT COUNT(*) as count
            FROM batch_transactions
            WHERE batch_id = $1 AND status = 'pending'
        `, [batch.id]);

        console.log(`\nPending Transactions: ${pendingRes.rows[0].count}`);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

checkLastBatch();
