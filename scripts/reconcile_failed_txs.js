
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
    "function processedLeaves(bytes32) view returns (bool)"
];

async function reconcile() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const chainId = 137n; // Polygon Mainnet

    const batchId = 167; // Specific batch requested
    console.log(`🚀 Starting Reconciliation for Batch ${batchId}...`);

    try {
        // 1. Get failed transactions
        const failedRes = await pool.query(
            `SELECT * FROM batch_transactions WHERE batch_id = $1 AND status = 'FAILED'`,
            [batchId]
        );
        const failedTxs = failedRes.rows;
        console.log(`🔍 Found ${failedTxs.length} failed transactions in DB.`);

        // 2. Fetch Batch Funder
        const batchDetails = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        const funder = batchDetails.rows[0].funder_address;

        let fixedCount = 0;
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();

        for (const tx of failedTxs) {
            let shouldComplete = false;
            let finalHash = tx.tx_hash || 'ON_CHAIN_SYNC';

            // Option 1: If it has a hash, check if it was successful on-chain
            if (tx.tx_hash && tx.tx_hash.startsWith('0x')) {
                try {
                    const receipt = await provider.getTransactionReceipt(tx.tx_hash);
                    if (receipt && receipt.status === 1) {
                        console.log(`✅ Tx ${tx.id} confirmed via hash ${tx.tx_hash}`);
                        shouldComplete = true;
                        finalHash = tx.tx_hash;
                    }
                } catch (e) {
                    // Ignore receipt errors, fallback to merkle check
                }
            }

            // Option 2: Check processedLeaves (IDEMPOTENCY Check)
            if (!shouldComplete) {
                const amountVal = BigInt(tx.amount_usdc);
                const leafHash = ethers.keccak256(abiCoder.encode(
                    ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                    [chainId, CONTRACT_ADDRESS, BigInt(batchId), BigInt(tx.id), funder, tx.wallet_address_to, amountVal]
                ));

                const isProcessed = await contract.processedLeaves(leafHash);
                if (isProcessed) {
                    console.log(`✅ Tx ${tx.id} confirmed via on-chain mapping.`);
                    shouldComplete = true;
                }
            }

            // 3. Update DB if verified
            if (shouldComplete) {
                await pool.query(
                    `UPDATE batch_transactions SET status = 'COMPLETED', tx_hash = $1, updated_at = NOW() WHERE id = $2`,
                    [finalHash, tx.id]
                );
                fixedCount++;
            }

            // Throttle to avoid rate limits
            if (fixedCount % 10 === 0 && fixedCount > 0) {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        console.log(`\n🎉 Reconciliation Done! Fixed ${fixedCount} transactions.`);

        // Update Batch Status Summary
        const summaryRes = await pool.query(`
            SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed
            FROM batch_transactions WHERE batch_id = $1
        `, [batchId]);

        const s = summaryRes.rows[0];
        console.log(`📊 Final Batch Status: ${s.completed}/${s.total} Completed.`);

    } catch (err) {
        console.error("❌ Reconciliation failed:", err);
    } finally {
        await pool.end();
    }
}

reconcile();
