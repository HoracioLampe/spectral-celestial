require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function recoverFunderRelayerFunds() {
    try {
        const funderAddress = '0x05dac55cc6fd7b84be32fd262ce4521eb6b29c38';
        const targetFaucet = '0x8Dd04f10017cc395F052d405354823b258343921';

        console.log(`\n🔄 Recuperando fondos de relayers del Funder...\n`);
        console.log(`👤 Funder: ${funderAddress}`);
        console.log(`💰 Faucet destino: ${targetFaucet}\n`);

        // 1. Find all batches for this funder
        const batchesRes = await pool.query(`
            SELECT id, batch_number, status
            FROM batches
            WHERE LOWER(funder_address) = LOWER($1)
            ORDER BY id
        `, [funderAddress]);

        if (batchesRes.rows.length === 0) {
            console.log('❌ No se encontraron batches para este funder');
            return;
        }

        console.log(`📦 Batches encontrados: ${batchesRes.rows.length}`);
        batchesRes.rows.forEach(b => {
            console.log(`   - Batch ${b.id}: ${b.batch_number || 'Sin número'} (${b.status})`);
        });
        console.log('');

        // 2. Get all relayers for these batches
        const batchIds = batchesRes.rows.map(b => b.id);
        const relayersRes = await pool.query(`
            SELECT r.address, r.private_key, r.last_balance, r.batch_id
            FROM relayers r
            WHERE r.batch_id = ANY($1)
            ORDER BY r.batch_id, r.id
        `, [batchIds]);

        if (relayersRes.rows.length === 0) {
            console.log('❌ No se encontraron relayers para estos batches');
            return;
        }

        console.log(`👥 Relayers encontrados: ${relayersRes.rows.length}\n`);

        // 3. Connect to blockchain
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        let totalRecovered = 0n;
        let successCount = 0;
        let skippedCount = 0;

        // 4. Sweep each relayer
        for (let i = 0; i < relayersRes.rows.length; i++) {
            const relayer = relayersRes.rows[i];

            try {
                const wallet = new ethers.Wallet(relayer.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                if (balance === 0n) {
                    console.log(`${i + 1}. [Batch ${relayer.batch_id}] ${wallet.address.substring(0, 10)}... - Balance: 0 MATIC (skip)`);
                    skippedCount++;
                    continue;
                }

                // Calculate gas cost (21000 gas for simple transfer)
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || 50000000000n;
                const gasCost = 21000n * gasPrice;

                // Amount to send (balance - gas)
                const amountToSend = balance - gasCost;

                if (amountToSend <= 0n) {
                    console.log(`${i + 1}. [Batch ${relayer.batch_id}] ${wallet.address.substring(0, 10)}... - Balance: ${ethers.formatEther(balance)} MATIC (insuficiente para gas)`);
                    skippedCount++;
                    continue;
                }

                // Send transaction
                const tx = await wallet.sendTransaction({
                    to: targetFaucet,
                    value: amountToSend,
                    gasLimit: 21000,
                    gasPrice: gasPrice
                });

                console.log(`${i + 1}. [Batch ${relayer.batch_id}] ${wallet.address.substring(0, 10)}... - Enviando ${ethers.formatEther(amountToSend)} MATIC...`);

                // Wait for confirmation
                const receipt = await tx.wait();

                if (receipt.status === 1) {
                    totalRecovered += amountToSend;
                    successCount++;
                    console.log(`   ✅ Confirmado (tx: ${tx.hash.substring(0, 20)}...)`);
                } else {
                    console.log(`   ❌ Falló`);
                }

                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                console.log(`${i + 1}. [Batch ${relayer.batch_id}] ${relayer.address.substring(0, 10)}... - ❌ Error: ${error.message}`);
            }
        }

        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║           📊 RESUMEN DE RECUPERACIÓN                       ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║ Funder:               ${funderAddress.substring(0, 36).padEnd(36)} ║`);
        console.log(`║ Batches procesados:   ${String(batchesRes.rows.length).padEnd(36)} ║`);
        console.log(`║ Relayers procesados:  ${String(relayersRes.rows.length).padEnd(36)} ║`);
        console.log(`║ Exitosos:             ${String(successCount).padEnd(36)} ║`);
        console.log(`║ Omitidos (sin fondos):${String(skippedCount).padEnd(36)} ║`);
        console.log(`║ Total recuperado:     ${ethers.formatEther(totalRecovered).padEnd(28)} MATIC ║`);
        console.log(`║ Faucet destino:       ${targetFaucet.substring(0, 36).padEnd(36)} ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);

    } catch (error) {
        console.error('\n❌ Error:', error);
    } finally {
        await pool.end();
    }
}

recoverFunderRelayerFunds();
