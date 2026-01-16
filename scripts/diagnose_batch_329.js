require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function checkBatch329() {
    try {
        const batchId = 329;
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        console.log(`\n🔍 Diagnóstico Batch ${batchId}\n`);

        // Get batch info
        const batchRes = await pool.query(`
            SELECT funder_address, total_transactions, status
            FROM batches WHERE id = $1
        `, [batchId]);

        const batch = batchRes.rows[0];
        console.log(`📦 Batch Info:`);
        console.log(`   Funder: ${batch.funder_address}`);
        console.log(`   Total TXs: ${batch.total_transactions}`);
        console.log(`   Status: ${batch.status}\n`);

        // Get Faucet
        const faucetRes = await pool.query(`
            SELECT address FROM faucets 
            WHERE LOWER(funder_address) = LOWER($1) LIMIT 1
        `, [batch.funder_address]);

        if (faucetRes.rows.length > 0) {
            const faucetAddress = faucetRes.rows[0].address;
            const faucetBalance = await provider.getBalance(faucetAddress);
            console.log(`💰 Faucet: ${faucetAddress}`);
            console.log(`   Balance: ${ethers.formatEther(faucetBalance)} MATIC\n`);
        }

        // Get relayers
        const relayersRes = await pool.query(`
            SELECT address, last_balance FROM relayers 
            WHERE batch_id = $1 ORDER BY id
        `, [batchId]);

        console.log(`👥 Relayers (${relayersRes.rows.length}):`);
        console.log(`─────────────────────────────────────────`);

        let totalBalance = 0n;
        let zeroCount = 0;

        for (const relayer of relayersRes.rows) {
            const balance = await provider.getBalance(relayer.address);
            totalBalance += balance;

            if (balance === 0n) zeroCount++;

            const balanceStr = ethers.formatEther(balance);
            const status = balance === 0n ? '❌ SIN GAS' : balance < ethers.parseEther('0.01') ? '⚠️  BAJO' : '✅';
            console.log(`${status} ${relayer.address.substring(0, 10)}... - ${balanceStr} MATIC`);
        }

        console.log(`\n📊 Resumen:`);
        console.log(`   Total balance relayers: ${ethers.formatEther(totalBalance)} MATIC`);
        console.log(`   Relayers sin gas: ${zeroCount}/${relayersRes.rows.length}`);
        console.log(`   Promedio por relayer: ${ethers.formatEther(totalBalance / BigInt(relayersRes.rows.length))} MATIC\n`);

        // Check transaction status
        const txRes = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM batch_transactions
            WHERE batch_id = $1
            GROUP BY status
        `, [batchId]);

        console.log(`📋 Estado de Transacciones:`);
        txRes.rows.forEach(row => {
            console.log(`   ${row.status}: ${row.count}`);
        });
        console.log('');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkBatch329();
