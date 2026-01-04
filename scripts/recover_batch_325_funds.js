require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function recoverBatch325Funds() {
    try {
        const batchId = 325;

        console.log(`\n🔄 Recuperando fondos del Batch ${batchId}...\n`);

        // 1. Get batch info
        const batchRes = await pool.query(`SELECT funder_address FROM batches WHERE id = $1`, [batchId]);
        if (batchRes.rows.length === 0) {
            console.log('❌ Batch 325 no encontrado');
            return;
        }

        const funderAddress = batchRes.rows[0].funder_address;
        console.log(`📦 Batch ${batchId}`);
        console.log(`👤 Funder: ${funderAddress}`);

        // 2. Get Faucet for this funder
        const faucetRes = await pool.query(`
            SELECT address, private_key 
            FROM faucets 
            WHERE LOWER(funder_address) = LOWER($1) 
            LIMIT 1
        `, [funderAddress]);

        if (faucetRes.rows.length === 0) {
            console.log(`❌ No se encontró Faucet para el funder ${funderAddress}`);
            return;
        }

        const faucetAddress = faucetRes.rows[0].address;
        console.log(`💰 Faucet destino: ${faucetAddress}\n`);

        // 3. Get all relayers for this batch
        const relayersRes = await pool.query(`
            SELECT address, private_key, last_balance
            FROM relayers
            WHERE batch_id = $1
            ORDER BY id
        `, [batchId]);

        if (relayersRes.rows.length === 0) {
            console.log('❌ No se encontraron relayers para este batch');
            return;
        }

        console.log(`👥 Relayers encontrados: ${relayersRes.rows.length}\n`);

        // 4. Connect to blockchain
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        let totalRecovered = 0n;
        let successCount = 0;

        // 5. Sweep each relayer
        for (let i = 0; i < relayersRes.rows.length; i++) {
            const relayer = relayersRes.rows[i];

            try {
                const wallet = new ethers.Wallet(relayer.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                if (balance === 0n) {
                    console.log(`${i + 1}. ${wallet.address.substring(0, 10)}... - Balance: 0 MATIC (skip)`);
                    continue;
                }

                // Calculate gas cost (21000 gas for simple transfer)
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice || 50000000000n;
                const gasCost = 21000n * gasPrice;

                // Amount to send (balance - gas)
                const amountToSend = balance - gasCost;

                if (amountToSend <= 0n) {
                    console.log(`${i + 1}. ${wallet.address.substring(0, 10)}... - Balance: ${ethers.formatEther(balance)} MATIC (insuficiente para gas)`);
                    continue;
                }

                // Send transaction
                const tx = await wallet.sendTransaction({
                    to: faucetAddress,
                    value: amountToSend,
                    gasLimit: 21000,
                    gasPrice: gasPrice
                });

                console.log(`${i + 1}. ${wallet.address.substring(0, 10)}... - Enviando ${ethers.formatEther(amountToSend)} MATIC...`);

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
                console.log(`${i + 1}. ${relayer.address.substring(0, 10)}... - ❌ Error: ${error.message}`);
            }
        }

        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║           📊 RESUMEN DE RECUPERACIÓN                       ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║ Relayers procesados:  ${String(relayersRes.rows.length).padEnd(36)} ║`);
        console.log(`║ Exitosos:             ${String(successCount).padEnd(36)} ║`);
        console.log(`║ Total recuperado:     ${ethers.formatEther(totalRecovered).padEnd(28)} MATIC ║`);
        console.log(`║ Faucet destino:       ${faucetAddress.substring(0, 36).padEnd(36)} ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);

    } catch (error) {
        console.error('\n❌ Error:', error);
    } finally {
        await pool.end();
    }
}

recoverBatch325Funds();
