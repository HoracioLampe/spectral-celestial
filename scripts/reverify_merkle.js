const { Pool } = require('pg');
const ethers = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Helper from server.js
async function getMerkleProof(client, batchId, transactionId) {
    console.log(`Getting proof for Batch ${batchId}, Tx ${transactionId}`);

    // Check if leaf exists first
    const startRes = await client.query(
        `SELECT position_index, hash FROM merkle_nodes WHERE batch_id = $1 AND level = 0 AND transaction_id = $2`,
        [batchId, transactionId]
    );
    if (startRes.rows.length === 0) throw new Error("Transaction leaf not found");

    const startNode = startRes.rows[0];
    console.log(`Leaf found at index ${startNode.position_index}: ${startNode.hash}`);

    const maxLevelRes = await client.query(
        `SELECT MAX(level) as max_level FROM merkle_nodes WHERE batch_id = $1`,
        [batchId]
    );
    const maxLevel = maxLevelRes.rows[0].max_level;
    console.log(`Max level: ${maxLevel}`);

    let currentIndex = startNode.position_index;
    const proof = [];

    for (let level = 0; level < maxLevel; level++) {
        const siblingIndex = currentIndex ^ 1;
        const siblingRes = await client.query(
            `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
            [batchId, level, siblingIndex]
        );

        if (siblingRes.rows.length > 0) {
            console.log(`L${level}: Found sibling at ${siblingIndex}: ${siblingRes.rows[0].hash.slice(0, 10)}...`);
            proof.push(siblingRes.rows[0].hash);
        } else {
            // Self-pairing handling
            const currentRes = await client.query(
                `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
                [batchId, level, currentIndex]
            );
            if (currentRes.rows.length > 0) {
                console.log(`L${level}: Self-pairing at ${currentIndex}: ${currentRes.rows[0].hash.slice(0, 10)}...`);
                proof.push(currentRes.rows[0].hash);
            } else {
                console.error(`L${level}: NO NODE FOUND at index ${currentIndex} or sibling ${siblingIndex}!`);
            }
        }
        currentIndex = currentIndex >> 1;
    }
    return { proof, leaf: startNode.hash };
}

function verifyMerkle(proof, root, leaf) {
    let computedHash = leaf;
    for (const proofElement of proof) {
        if (BigInt(computedHash) <= BigInt(proofElement)) {
            computedHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [computedHash, proofElement]);
        } else {
            computedHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [proofElement, computedHash]);
        }
    }
    return computedHash === root;
}

async function run() {
    const client = await pool.connect();
    try {
        const batchRes = await client.query('SELECT id, merkle_root, funder_address FROM batches WHERE id = 102');
        const batch = batchRes.rows[0];
        console.log(`Testing Batch ID: ${batch.id}`);
        console.log(`Funder stored in DB (RAW): '${batch.funder_address}'`);
        console.log(`Is Lowercase? ${batch.funder_address === batch.funder_address.toLowerCase()}`);
        console.log(`Expected Root: ${batch.merkle_root}`);

        const txRes = await client.query('SELECT id FROM batch_transactions WHERE batch_id = $1 LIMIT 1', [batch.id]);
        if (txRes.rows.length === 0) throw new Error("No transactions");
        const txId = txRes.rows[0].id;

        const { proof, leaf } = await getMerkleProof(client, batch.id, txId);

        console.log(`Proof length: ${proof.length}`);

        const isValid = verifyMerkle(proof, batch.merkle_root, leaf);
        console.log(`\nLocal Verification Result: ${isValid ? "✅ PASS" : "❌ FAIL"}`);

        if (!isValid) {
            console.log("Debug Info:");
            console.log("Leaf:", leaf);
            console.log("Proof:", JSON.stringify(proof));
        }

    } catch (e) {
        console.error(e);
    } finally {
        client.release();
        pool.end();
    }
}

run();
