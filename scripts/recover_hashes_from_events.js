
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const CONTRACT_ADDRESS = "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
const CONTRACT_ABI = [
    "event TransactionExecuted(uint256 indexed batchId, uint256 indexed txId, address indexed recipient, address funder, uint256 amount)"
];

async function recover() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const batchId = 167;

    console.log(`🚀 Recuperación Multi-Chunk para Batch ${batchId}...`);

    try {
        const latestBlock = await provider.getBlockNumber();
        const totalBlocks = 30000;
        const chunkSize = 5000;
        let allLogs = [];

        for (let i = 0; i < totalBlocks; i += chunkSize) {
            const end = latestBlock - i;
            const start = end - chunkSize;
            console.log(`🔎 Bloques ${start} -> ${end}...`);

            try {
                const logs = await contract.queryFilter(contract.filters.TransactionExecuted(batchId), start, end);
                allLogs = allLogs.concat(logs);
                console.log(`   + Encontrados ${logs.length} eventos.`);
            } catch (e) {
                console.warn(`   ⚠️ Error en chunk ${start}-${end}: ${e.message}`);
                // Try smaller sub-chunk if it fails? No, just continue.
            }
            await new Promise(r => setTimeout(r, 200)); // Throttle
        }

        console.log(`✅ Total Eventos Encontrados: ${allLogs.length}`);

        let updatedCount = 0;
        for (const log of allLogs) {
            const txId = Number(log.args.txId);
            const txHash = log.transactionHash;
            const amount = log.args.amount.toString();

            const res = await pool.query(
                `UPDATE batch_transactions 
                 SET status = 'COMPLETED', tx_hash = $1, amount_transferred = $2, updated_at = NOW() 
                 WHERE batch_id = $3 AND id = $4 AND status != 'COMPLETED'`,
                [txHash, amount, batchId, txId]
            );

            if (res.rowCount > 0) {
                updatedCount++;
            }
        }

        console.log(`🎉 DB Sincronizada: ${updatedCount} transacciones corregidas.`);

    } catch (err) {
        console.error("❌ Fallo crítico:", err);
    } finally {
        await pool.end();
    }
}

recover();
