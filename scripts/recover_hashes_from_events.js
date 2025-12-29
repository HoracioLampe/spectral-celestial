
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const CONTRACT_ADDRESS = "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";

// We only need the event definition in the ABI
const CONTRACT_ABI = [
    "event TransactionExecuted(uint256 indexed batchId, uint256 indexed txId, address indexed recipient, address funder, uint256 amount)"
];

async function recover() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    const batchId = 167; // The batch to recover hashes for
    console.log(`🚀 Iniciando recuperación de hashes vía Eventos para Batch ${batchId}...`);

    try {
        // 1. Get current block to define search range
        const latestBlock = await provider.getBlockNumber();
        const startBlock = latestBlock - 5000; // Search last ~3 hours of Polygon blocks

        console.log(`🔎 Buscando eventos desde bloque ${startBlock} hasta ${latestBlock}...`);

        // 2. Query logs for this specific batchId
        // The first 'indexed' parameter after the event name is the first filter argument
        const filter = contract.filters.TransactionExecuted(batchId);
        const logs = await contract.queryFilter(filter, startBlock, latestBlock);

        console.log(`✅ Se encontraron ${logs.length} transacciones ejecutadas en la blockchain.`);

        let updatedCount = 0;
        for (const log of logs) {
            const txId = Number(log.args.txId);
            const txHash = log.transactionHash;

            // 3. Update only those that don't have a real hash in DB
            const res = await pool.query(
                `UPDATE batch_transactions 
                 SET tx_hash = $1, updated_at = NOW() 
                 WHERE batch_id = $2 
                 AND id = $3 
                 AND (tx_hash IS NULL OR tx_hash = 'ON_CHAIN_SYNC' OR tx_hash = 'ON_CHAIN_DEDUPE')`,
                [txHash, batchId, txId]
            );

            if (res.rowCount > 0) {
                console.log(`🔗 Hash restaurado para Tx ${txId}: ${txHash}`);
                updatedCount++;
            }
        }

        console.log(`\n🎉 Proceso finalizado. Se restauraron ${updatedCount} hashes en la base de datos.`);

    } catch (err) {
        console.error("❌ Error en la recuperación:", err);
    } finally {
        await pool.end();
    }
}

recover();
