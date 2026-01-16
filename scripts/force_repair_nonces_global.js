
const { ethers } = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function repairAllGlobal() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    try {
        console.log(`🛠️ INICIANDO REPARACIÓN GLOBAL DE NONCES...`);
        // We only check relayers that have balance or are recently active
        const res = await pool.query("SELECT address, private_key FROM relayers WHERE last_balance != '0' OR last_activity > NOW() - INTERVAL '3 DAY'");

        console.log(`🔍 Escaneando ${res.rows.length} relayers candidatos...`);

        for (const r of res.rows) {
            const relayerAddr = r.address;
            const wallet = new ethers.Wallet(r.private_key, provider);

            let latest = await provider.getTransactionCount(relayerAddr, "latest");
            let pending = await provider.getTransactionCount(relayerAddr, "pending");

            let attempt = 0;
            while (pending > latest && attempt < 5) {
                attempt++;
                console.log(`⚠️ Relayer ${relayerAddr.substring(0, 10)} bloqueado (L:${latest} P:${pending})`);

                const feeData = await provider.getFeeData();
                const boostPrice = (feeData.gasPrice * 800n) / 100n; // 8x gas

                try {
                    const tx = await wallet.sendTransaction({
                        to: relayerAddr,
                        value: 0,
                        nonce: latest,
                        gasLimit: 30000,
                        gasPrice: boostPrice
                    });
                    console.log(`   🚀 Corrección enviada: ${tx.hash}`);
                    await tx.wait(1);
                    console.log(`   ✅ Ticket ${latest} liberado.`);
                } catch (e) {
                    console.log(`   ❌ Error reparando ${relayerAddr}: ${e.message}`);
                    break;
                }
                latest = await provider.getTransactionCount(relayerAddr, "latest");
                pending = await provider.getTransactionCount(relayerAddr, "pending");
            }
        }
        console.log(`✨ Reparación global finalizada.`);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

repairAllGlobal();
