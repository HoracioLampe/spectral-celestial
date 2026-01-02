require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function checkBatch294Detailed() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const provider = new ethers.JsonRpcProvider(
        process.env.POLYGON_RPC_URL || process.env.RPC_URL || 'https://polygon-rpc.com'
    );

    try {
        console.log('=== Batch 294 Detailed Check ===\n');

        // Get batch info
        const batchRes = await pool.query('SELECT * FROM batches WHERE id = 294');
        const batch = batchRes.rows[0];

        console.log('📦 Batch Status:', batch.status);
        console.log('📊 Total Transactions:', batch.total_transactions);
        console.log('🌳 Merkle Root:', batch.merkle_root ? 'SET ✅' : 'NOT SET ❌');
        console.log('');

        // Get relayers
        const relayerRes = await pool.query('SELECT * FROM relayers WHERE batch_id = 294');
        console.log(`⚡ Relayers: ${relayerRes.rows.length}`);

        if (relayerRes.rows.length === 0) {
            console.log('❌ NO RELAYERS CREATED - This is the problem!');
            console.log('   Solution: Go to batch detail page and click "Preparar Relayers"');
            return;
        }

        // Check relayer balances on-chain
        console.log('\n💰 Checking Relayer Balances on Polygon...\n');

        let totalBalance = 0n;
        let activeRelayers = 0;

        for (let i = 0; i < Math.min(5, relayerRes.rows.length); i++) {
            const relayer = relayerRes.rows[i];
            try {
                const balance = await provider.getBalance(relayer.address);
                const balanceEth = ethers.formatEther(balance);
                totalBalance += balance;

                if (balance > ethers.parseEther('0.01')) {
                    activeRelayers++;
                }

                console.log(`  ${relayer.address.substring(0, 10)}... | ${balanceEth} MATIC | Status: ${relayer.status || 'N/A'}`);
            } catch (err) {
                console.log(`  ${relayer.address.substring(0, 10)}... | Error: ${err.message}`);
            }
        }

        if (relayerRes.rows.length > 5) {
            console.log(`  ... and ${relayerRes.rows.length - 5} more relayers`);
        }

        console.log(`\n📊 Active Relayers (>0.01 MATIC): ${activeRelayers}/${relayerRes.rows.length}`);
        console.log(`💎 Total Balance (sample): ${ethers.formatEther(totalBalance)} MATIC`);

        // Check if there's a merkle_transactions table
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%merkle%'
        `);

        console.log('\n📋 Merkle Tables Found:');
        tableCheck.rows.forEach(r => console.log(`  - ${r.table_name}`));

        // Try to get transaction count from merkle_transactions
        try {
            const txCount = await pool.query('SELECT COUNT(*) FROM merkle_transactions WHERE batch_id = 294');
            console.log(`\n📨 Transactions in merkle_transactions: ${txCount.rows[0].count}`);

            // Get status breakdown
            const statusRes = await pool.query(`
                SELECT status, COUNT(*) as count 
                FROM merkle_transactions 
                WHERE batch_id = 294 
                GROUP BY status
            `);

            console.log('\n📊 Transaction Status:');
            statusRes.rows.forEach(r => {
                console.log(`  ${r.status}: ${r.count}`);
            });
        } catch (err) {
            console.log('\n⚠️  Could not query merkle_transactions:', err.message);
        }

        console.log('\n=== Diagnosis ===');
        if (activeRelayers === 0) {
            console.log('❌ No relayers have balance');
            console.log('   → Relayers may have already returned funds to faucet');
            console.log('   → Or atomic distribution never happened');
        } else {
            console.log('✅ Relayers have balance and are ready');
            console.log('   → Check server logs for processing errors');
            console.log('   → Batch may be stuck in processing loop');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

checkBatch294Detailed();
