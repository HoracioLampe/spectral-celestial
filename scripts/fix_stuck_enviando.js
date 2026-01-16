
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const CONTRACT_ADDRESS = "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";

async function investigate() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ['function processedLeaves(bytes32) view returns (bool)'], provider);
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    try {
        console.log("🕵️ Investigando transacciones bloqueadas en ENVIANDO...");

        const res = await pool.query("SELECT * FROM batch_transactions WHERE status = 'ENVIANDO' AND batch_id = 170");
        const txs = res.rows;

        console.log(`🔍 Encontradas ${txs.length} transacciones en estado ENVIANDO.`);

        const batchRes = await pool.query("SELECT funder_address FROM batches WHERE id = 170");
        const funder = batchRes.rows[0].funder_address;

        let onChainCount = 0;
        for (const tx of txs) {
            const leafHash = ethers.keccak256(abiCoder.encode(
                ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                [137n, CONTRACT_ADDRESS, BigInt(170), BigInt(tx.id), funder, tx.wallet_address_to, BigInt(tx.amount_usdc)]
            ));

            const isProcessed = await contract.processedLeaves(leafHash);
            if (isProcessed) {
                console.log(`✅ Tx ${tx.id} YA ESTÁ en la blockchain.`);
                onChainCount++;
                // Sync it
                await pool.query("UPDATE batch_transactions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1", [tx.id]);
            } else {
                console.log(`❌ Tx ${tx.id} NO está en la blockchain. Se reseteará a PENDING.`);
                await pool.query("UPDATE batch_transactions SET status = 'PENDING', updated_at = NOW() WHERE id = $1", [tx.id]);
            }
        }

        console.log(`\n🎉 Limpieza completada. ${onChainCount} estaban en chain, ${txs.length - onChainCount} se resetearon.`);

    } catch (err) {
        console.error("❌ Error en investigación:", err);
    } finally {
        await pool.end();
    }
}

investigate();
