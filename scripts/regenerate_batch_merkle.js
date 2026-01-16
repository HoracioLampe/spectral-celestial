const { Pool } = require('pg');
const ethers = require('ethers');
require('dotenv').config();

// Script: regenerate_batch_merkle.js
// Usage: node scripts/regenerate_batch_merkle.js <BATCH_ID>

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Reuse logic from RelayerEngine / Server (Simplified)
async function generateMerkleTree(client, batchId, funder) {
    const batchIdBig = BigInt(batchId);

    // 1. Fetch Transactions
    const txRes = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
    const transactions = txRes.rows;
    if (transactions.length === 0) throw new Error("No transactions in batch");

    console.log(`Creating Merkle Tree for ${transactions.length} transactions...`);

    // 2. Generate Leaves using NEW Contract Address Logic
    // Must match Solidity: keccak256(abi.encode(chainid, contract, batch, txId, funder, recipient, amount))
    const chainId = 137n; // Always 137 for Polygon Mainnet as per config
    const contractAddress = process.env.CONTRACT_ADDRESS;

    if (!contractAddress) throw new Error("CONTRACT_ADDRESS env var missing");

    const leaves = transactions.map(tx => {
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
            [
                chainId,
                contractAddress,
                batchIdBig,
                BigInt(tx.id),
                funder,
                tx.wallet_address_to,
                BigInt(tx.amount_usdc)
            ]
        );
        const leaf = ethers.keccak256(encoded);
        return { hash: leaf, txId: tx.id };
    });

    // 3. Build Tree & Store Nodes (Bulk Insert optimized)
    let currentLevel = leaves.map((l, i) => ({ hash: l.hash, index: i, txId: l.txId }));
    let level = 0;
    const allNodesToInsert = [];

    // Collect Level 0 (Leaves)
    for (const node of currentLevel) {
        allNodesToInsert.push({
            batch_id: batchId, level: 0, position: node.index,
            hash: node.hash, tx_id: node.txId, verified: false
        });
    }

    // Build upper levels
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = (i + 1 < currentLevel.length) ? currentLevel[i + 1] : left;

            const [hashA, hashB] = [left.hash, right.hash].sort();
            const parentHash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [hashA, hashB]);

            const parentIndex = Math.floor(i / 2);
            nextLevel.push({ hash: parentHash, index: parentIndex });

            allNodesToInsert.push({
                batch_id: batchId, level: level + 1, position: parentIndex,
                hash: parentHash, tx_id: null, verified: false
            });
        }
        currentLevel = nextLevel;
        level++;
    }

    const root = currentLevel[0].hash;

    // 4. Batch Insert
    console.log(`Inserting ${allNodesToInsert.length} nodes (Bulk)...`);
    const chunkSize = 1000;
    for (let i = 0; i < allNodesToInsert.length; i += chunkSize) {
        const chunk = allNodesToInsert.slice(i, i + chunkSize);

        const params = [];
        const placeholders = chunk.map((n, idx) => {
            const offset = idx * 6;
            params.push(n.batch_id, n.level, n.position, n.hash, n.tx_id, n.verified);
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
        }).join(",");

        await client.query(
            `INSERT INTO merkle_nodes (batch_id, level, position_index, hash, transaction_id, verified_on_chain) 
             VALUES ${placeholders}`,
            params
        );
    }
    return root;
}

async function run() {
    const batchId = process.argv[2];
    if (!batchId) {
        console.error("Provide Batch ID");
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log(`🧹 Cleaning old Merkle data for Batch ${batchId}...`);

        // 1. Get Batch Info (Need funder)
        const batchRes = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) throw new Error("Batch not found");
        const batch = batchRes.rows[0];

        // Use funder from batch, or fallback
        const funder = batch.funder_address || "0x8888888888888888888888888888888888888888";

        // 2. Delete old nodes
        await client.query('DELETE FROM merkle_nodes WHERE batch_id = $1', [batchId]);

        // 3. Regenerate
        const newRoot = await generateMerkleTree(client, batchId, funder);
        console.log(`🌱 New Merkle Root: ${newRoot}`);

        // 4. Update Batch record
        await client.query('UPDATE batches SET merkle_root = $1 WHERE id = $2', [newRoot, batchId]);

        await client.query('COMMIT');
        console.log("✅ Regeneration Successful.");

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Error:", err);
    } finally {
        client.release();
        pool.end();
    }
}

run();
