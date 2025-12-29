
const { ethers } = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function repairAll() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const faucetRes = await pool.query('SELECT address, private_key FROM faucets ORDER BY id DESC LIMIT 1');
    const faucetKey = faucetRes.rows[0].private_key;
    const faucetWallet = new ethers.Wallet(faucetKey, provider);

    try {
        const res = await pool.query("SELECT address, private_key FROM relayers WHERE batch_id = 170");
        console.log(`🛠️ INICIANDO AUTO-REPARACIÓN DE NONCES...`);

        for (const r of res.rows) {
            const relayerAddr = r.address;
            const wallet = new ethers.Wallet(r.private_key, provider);

            let latest = await provider.getTransactionCount(relayerAddr, "latest");
            let pending = await provider.getTransactionCount(relayerAddr, "pending");

            let attempt = 0;
            while (pending > latest && attempt < 10) {
                attempt++;
                console.log(`⚠️ Relayer ${relayerAddr.substring(0, 10)} bloqueado (L:${latest} P:${pending}). Intento ${attempt}`);

                const feeData = await provider.getFeeData();
                const boostPrice = (feeData.gasPrice * 800n) / 100n; // 8x gas!

                try {
                    const tx = await wallet.sendTransaction({
                        to: relayerAddr,
                        value: 0,
                        nonce: latest,
                        gasLimit: 30000,
                        gasPrice: boostPrice
                    });
                    console.log(`   🚀 Enviada corrección: ${tx.hash} (Gas: ${ethers.formatUnits(boostPrice, 'gwei')} gwei)`);
                    await tx.wait(1);
                    console.log(`   ✅ Ticket ${latest} liberado.`);
                    await new Promise(r => setTimeout(r, 2000)); // Delay for RPC convergence
                } catch (e) {
                    console.log(`   ❌ Error reparando: ${e.message}`);
                    break;
                }
                latest = await provider.getTransactionCount(relayerAddr, "latest");
                pending = await provider.getTransactionCount(relayerAddr, "pending");
            }
        }
        console.log(`✨ Proceso de reparación finalizado.`);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

repairAll();
