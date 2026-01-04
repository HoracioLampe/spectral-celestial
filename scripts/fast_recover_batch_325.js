require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function fastRecoverBatch325() {
    try {
        const batchId = 325;
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        console.log(`\n🚀 Recuperación RÁPIDA - Batch ${batchId}\n`);

        // 1. Get Faucet
        const batchRes = await pool.query(`SELECT funder_address FROM batches WHERE id = $1`, [batchId]);
        const funderAddress = batchRes.rows[0].funder_address;

        const faucetRes = await pool.query(`
            SELECT address FROM faucets 
            WHERE LOWER(funder_address) = LOWER($1) LIMIT 1
        `, [funderAddress]);

        const faucetAddress = faucetRes.rows[0].address;
        console.log(`💰 Faucet: ${faucetAddress}\n`);

        // 2. Get ALL relayers with private keys (NO balance check)
        const relayersRes = await pool.query(`
            SELECT address, private_key
            FROM relayers
            WHERE batch_id = $1
            ORDER BY id
        `, [batchId]);

        console.log(`👥 Procesando ${relayersRes.rows.length} relayers...\n`);

        let totalRecovered = 0n;
        let successCount = 0;
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n;
        const gasCost = 21000n * gasPrice;

        // 3. Process in parallel batches of 10
        for (let i = 0; i < relayersRes.rows.length; i += 10) {
            const batch = relayersRes.rows.slice(i, Math.min(i + 10, relayersRes.rows.length));

            await Promise.all(batch.map(async (relayer, idx) => {
                try {
                    const wallet = new ethers.Wallet(relayer.private_key, provider);

                    // Send max possible (will fail if insufficient, but that's OK)
                    const tx = await wallet.sendTransaction({
                        to: faucetAddress,
                        value: ethers.parseEther("10"), // Intentar enviar todo
                        gasLimit: 21000,
                        gasPrice: gasPrice
                    }).catch(() => null);

                    if (tx) {
                        await tx.wait();
                        console.log(`✅ ${i + idx + 1}. ${wallet.address.substring(0, 10)}...`);
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

fastRecoverBatch325();
