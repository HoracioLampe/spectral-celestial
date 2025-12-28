const { Pool } = require('pg');
const ethers = require('ethers');
require('dotenv').config();

// Script: verify_batch_on_chain.js
// Purpose: Fetch batch from DB -> Get Proof -> Call Smart Contract -> Update DB Status

// Constants
const STATUS = {
    NOT_TESTED: 'NOT_TESTED',
    OK: 'TESTED_OK',
    ERROR: 'TESTED_ERROR'
};

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function getMerkleProof(client, batchId, transactionId) {
    // Logic extracted from RelayerEngine.js to ensure consistency
    const startRes = await client.query(
        `SELECT position_index, hash FROM merkle_nodes WHERE batch_id = $1 AND level = 0 AND transaction_id = $2`,
        [batchId, transactionId]
    );
    if (startRes.rows.length === 0) throw new Error("Transaction leaf not found in merkle_nodes");

    const maxLevelRes = await client.query(
        `SELECT MAX(level) as max_level FROM merkle_nodes WHERE batch_id = $1`,
        [batchId]
    );
    const maxLevel = maxLevelRes.rows[0].max_level;

    let currentIndex = startRes.rows[0].position_index;
    const proof = [];

    for (let level = 0; level < maxLevel; level++) {
        const siblingIndex = currentIndex ^ 1;
        const siblingRes = await client.query(
            `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
            [batchId, level, siblingIndex]
        );

        if (siblingRes.rows.length > 0) {
            proof.push(siblingRes.rows[0].hash);
        } else {
            // Self-pairing handling (if odd number of nodes)
            const currentRes = await client.query(
                `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
                [batchId, level, currentIndex]
            );
            if (currentRes.rows.length > 0) {
                proof.push(currentRes.rows[0].hash);
            }
        }
        currentIndex = currentIndex >> 1;
    }
    return proof;
}

async function verifyBatch(batchId) {
    const client = await pool.connect();
    try {
        console.log(`\n🔍 Verifying Batch ${batchId}...`);

        // 1. Get Batch Info
        const batchRes = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) {
            console.error("Batch not found");
            return;
        }
        const batch = batchRes.rows[0];
        console.log("DEBUG BATCH:", batch);

        if (!batch.merkle_root) {
            console.log("⚠️ Batch has no Merkle Root yet.");
            // await client.query('UPDATE batches SET merkle_status = $1 WHERE id = $2', [STATUS.NOT_TESTED, batchId]);
            return;
        }

        // 2. Get 1 Transaction to test (Random or First)
        // We test a real leaf against the contract.
        const txRes = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1 LIMIT 1', [batchId]);
        if (txRes.rows.length === 0) {
            console.log("⚠️ No transactions in batch.");
            return;
        }
        const tx = txRes.rows[0];

        // 3. Get Proof from DB (using Relayer Logic)
        const proof = await getMerkleProof(client, batchId, tx.id);

        // 4. Connect to Blockchain
        const providerUrl = process.env.RPC_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const contractAddress = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";

        const abi = ["function validateMerkleProofDetails(uint256, uint256, address, address, uint256, bytes32, bytes32[]) external view returns (bool)"];
        const contract = new ethers.Contract(contractAddress, abi, provider);

        console.log(`   Tx ID: ${tx.id}`);
        console.log(`   Recipient: ${tx.wallet_address_to}`);
        console.log(`   Amount: ${tx.amount_usdc} (microUSDC)`);
        console.log(`   Root: ${batch.merkle_root}`);
        console.log(`   Proof Size: ${proof.length}`);

        // 5. Verify Loop
        const funder = batch.funder_address || "0x8888888888888888888888888888888888888888";

        // Fetch ALL transactions for this batch to verify them individually
        const allTxs = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [batchId]);

        console.log(`\n🔍 Verifying ${allTxs.rows.length} transactions for Batch ${batchId}...`);

        for (const tx of allTxs.rows) {
            try {
                const proof = await getMerkleProof(client, batchId, tx.id);

                const isValid = await contract.validateMerkleProofDetails(
                    BigInt(batchId),
                    BigInt(tx.id),
                    funder,
                    tx.wallet_address_to,
                    BigInt(tx.amount_usdc),
                    batch.merkle_root,
                    proof
                );

                if (isValid) {
                    process.stdout.write("✅");
                    // Update merkle_nodes table
                    await client.query(
                        `UPDATE merkle_nodes SET verified_on_chain = TRUE, verification_timestamp = NOW() 
                         WHERE batch_id = $1 AND transaction_id = $2 AND level = 0`,
                        [batchId, tx.id]
                    );
                } else {
                    process.stdout.write("❌");
                    console.error(`\nFailed Tx ID: ${tx.id}`);
                }
            } catch (err) {
                process.stdout.write("⚠️");
                console.error(`\nError Tx ID: ${tx.id}`, err.message);
            }
        }
        console.log("\n\n✨ Batch Verification Complete.");

    } catch (e) {
        console.error("Exec Error:", e);
    } finally {
        client.release();
    }
}

// CLI Argument: node scripts/verify_batch_on_chain.js <BATCH_ID>
const args = process.argv.slice(2);
if (args.length > 0) {
    verifyBatch(args[0]).then(() => {
        pool.end();
    });
} else {
    // If no arg, list batches 
    (async () => {
        const client = await pool.connect();
        const res = await client.query('SELECT id, batch_number, status FROM batches ORDER BY id DESC LIMIT 5');
        console.table(res.rows);
        console.log("\nUsage: node scripts/verify_batch_on_chain.js <BATCH_ID>");
        client.release();
        pool.end();
    })();
}
