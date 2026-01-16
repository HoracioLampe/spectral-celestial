require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function fastRecoverFunder() {
    try {
        const funderAddress = '0x05dac55cc6fd7b84be32fd262ce4521eb6b29c38';
        const targetFaucet = '0x8Dd04f10017cc395F052d405354823b258343921';
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        console.log(`\n🚀 Recuperación RÁPIDA - Funder ${funderAddress}\n`);
        console.log(`💰 Faucet: ${targetFaucet}\n`);

        // Get ALL relayers (NO balance check)
        const batchesRes = await pool.query(`
            SELECT id FROM batches 
            WHERE LOWER(funder_address) = LOWER($1)
        `, [funderAddress]);

        const batchIds = batchesRes.rows.map(b => b.id);

        const relayersRes = await pool.query(`
            SELECT address, private_key, batch_id
            FROM relayers
            WHERE batch_id = ANY($1)
            ORDER BY batch_id, id
        `, [batchIds]);

        console.log(`👥 Procesando ${relayersRes.rows.length} relayers de ${batchIds.length} batches...\n`);

        let successCount = 0;
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n;

        // Process in parallel batches of 10
        for (let i = 0; i < relayersRes.rows.length; i += 10) {
            const batch = relayersRes.rows.slice(i, Math.min(i + 10, relayersRes.rows.length));

            await Promise.all(batch.map(async (relayer, idx) => {
                try {
                    const wallet = new ethers.Wallet(relayer.private_key, provider);

                    const tx = await wallet.sendTransaction({
                        to: targetFaucet,
                        value: ethers.parseEther("200"), // Intentar enviar máximo posible
                        gasLimit: 21000,
                        gasPrice: gasPrice
                    }).catch(() => null);

                    if (tx) {
                        await tx.wait();
                        console.log(`✅ ${i + idx + 1}. [Batch ${relayer.batch_id}] ${wallet.address.substring(0, 10)}...`);
                        successCount++;
                    }
                } catch (e) {
                    // Skip silently
                }
            }));
        }

        console.log(`\n✅ Completado: ${successCount}/${relayersRes.rows.length} exitosos\n`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

fastRecoverFunder();
