const { Pool } = require('pg');
const { ethers } = require('ethers');

// Connection string from previous context or environment
// In a real app, use process.env.DATABASE_URL
const connectionString = "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway";

const pool = new Pool({
    connectionString: connectionString,
});

async function generatetransactions() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting generation of 1000 dummy transactions...");

        // 1. Create a specific batch for this load test
        const batchRef = `LOAD-TEST-${Date.now()}`;
        console.log(`Creating batch with reference: ${batchRef}`);

        const batchRes = await client.query(
            "INSERT INTO batches (batch_number, detail, status) VALUES ($1, $2, 'PREPARING') RETURNING id",
            [batchRef, 'Load Test 1000 Txs']
        );
        const batchId = batchRes.rows[0].id;
        console.log(`✅ Created Batch ID: ${batchId}`);

        // 2. Generate and Insert 1000 transactions
        const totalTxs = 1000;
        const amountUsdc = '100000'; // 0.1 USDC (6 decimals)

        console.log(`Beginning insert of ${totalTxs} transactions...`);

        const values = [];
        const params = [];
        let paramIndex = 1;

        // We'll do this in chunks to avoid hitting query size limits if any, 
        // though 1000 rows might fit in one insert. Let's do batches of 100.
        const chunkSize = 100;

        for (let i = 0; i < totalTxs; i++) {
            // Generate random wallet
            const wallet = ethers.Wallet.createRandom();
            const txRef = `REF-${batchId}-${i}-${Date.now()}`;

            // We insert row by row or construct a bulk insert. 
            // For simplicity and to show progress, let's just loop and insert or use bulk insert logic.
            // Bulk insert is much faster.

            if (i % chunkSize === 0 && i > 0) {
                // flush previous chunk (not implemented in this simple loop structure for clarity, 
                // but we will do a simple await loop for safety or a bulk query builder)
            }
        }

        // Optimized Bulk Insert Approach
        for (let i = 0; i < totalTxs; i += chunkSize) {
            const chunkValues = [];

            for (let j = 0; j < chunkSize && (i + j) < totalTxs; j++) {
                const wallet = ethers.Wallet.createRandom();
                const txRef = `REF-${batchId}-${i + j}`;

                chunkValues.push(`(${batchId}, '${wallet.address}', '${amountUsdc}', '${txRef}', 'PENDING')`);
            }

            const queryText = `
                INSERT INTO batch_transactions (batch_id, wallet_address_to, amount_usdc, transaction_reference, status) 
                VALUES ${chunkValues.join(',')}
            `;

            await client.query(queryText);
            console.log(`Inserted ${Math.min(i + chunkSize, totalTxs)} / ${totalTxs} transactions`);
        }

        console.log("✅ All 1000 transactions inserted successfully.");
        console.log(`Batch ID ${batchId} is ready for processing.`);
        console.log(`Run 'node scripts/process_batch.js ${batchId}' (or equivalent) to start.`);

    } catch (err) {
        console.error("❌ Error generating transactions:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

generatetransactions();
