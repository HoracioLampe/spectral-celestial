require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function recoverBatch327() {
    try {
        const batchId = 327;
        const targetFaucet = '0x8Dd04f10017cc395F052d405354823b258343921';
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        console.log(`\n🚀 RECUPERACIÓN BATCH 327\n`);
        console.log(`💰 Faucet destino: ${targetFaucet}\n`);

        // Get ALL relayers from Batch 327
        const relayersRes = await pool.query(`
            SELECT address, private_key, last_balance
            FROM relayers
            WHERE batch_id = $1
            ORDER BY id
        `, [batchId]);

        console.log(`👥 Relayers encontrados: ${relayersRes.rows.length}\n`);

        let totalRecovered = 0n;
        let successCount = 0;
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n;

        // Process in parallel batches of 5
        for (let i = 0; i < relayersRes.rows.length; i += 5) {
            const batch = relayersRes.rows.slice(i, Math.min(i + 5, relayersRes.rows.length));

            const results = await Promise.allSettled(batch.map(async (relayer, idx) => {
                try {
                    const wallet = new ethers.Wallet(relayer.private_key, provider);
                    const balance = await provider.getBalance(wallet.address);

                    if (balance === 0n) {
                        console.log(`${i + idx + 1}. ${wallet.address.substring(0, 10)}... - 0 MATIC (skip)`);
                        return null;
                    }

                    const gasCost = 21000n * gasPrice;
                    const amountToSend = balance - gasCost;

                    if (amountToSend <= 0n) {
                        console.log(`${i + idx + 1}. ${wallet.address.substring(0, 10)}... - Insuficiente para gas`);
                        return null;
                    }

                    const tx = await wallet.sendTransaction({
                        to: targetFaucet,
                        value: amountToSend,
                        gasLimit: 21000,
                        gasPrice: gasPrice
                    });

                    console.log(`${i + idx + 1}. ${wallet.address.substring(0, 10)}... - Enviando ${ethers.formatEther(amountToSend)} MATIC...`);

                    const receipt = await tx.wait();

                    if (receipt.status === 1) {
                        totalRecovered += amountToSend;
                        console.log(`   ✅ Confirmado`);

                        // Update DB to mark as drained
                        await pool.query(`
                            UPDATE relayers 
                            SET last_balance = '0', updated_at = NOW() 
                            WHERE LOWER(address) = LOWER($1)
                        `, [wallet.address]);

                        return amountToSend;
                    }

                    return null;
                } catch (error) {
                    console.log(`${i + idx + 1}. Error: ${error.message.substring(0, 50)}`);
                    return null;
                }
            }));

            successCount += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;

            if (i + 5 < relayersRes.rows.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║           📊 RESUMEN BATCH 327                             ║`);
        console.log(`╠════════════════════════════════════════════════════════════╣`);
        console.log(`║ Relayers procesados:  ${String(relayersRes.rows.length).padEnd(36)} ║`);
        console.log(`║ Exitosos:             ${String(successCount).padEnd(36)} ║`);
        console.log(`║ Total recuperado:     ${ethers.formatEther(totalRecovered).padEnd(28)} MATIC ║`);
        console.log(`║ Faucet destino:       ${targetFaucet.substring(0, 36).padEnd(36)} ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);

    } catch (error) {
        console.error('\n❌ Error:', error);
    } finally {
        await pool.end();
    }
}

recoverBatch327();
