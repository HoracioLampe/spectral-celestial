const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway",
});

async function testInsert() {
    const client = await pool.connect();
    try {
        console.log("Testing manual insert into batch_transactions...");

        // Create a dummy batch first if needed, or use ID 1 (assuming it exists or we fail)
        // Let's first check if batch 1 exists
        const batchCheck = await client.query('SELECT id FROM batches LIMIT 1');
        let batchId;

        if (batchCheck.rows.length === 0) {
            console.log("No batches found. Creating dummy batch...");
            const newBatch = await client.query("INSERT INTO batches (batch_number, detail, status) VALUES ('TEST-001', 'Manual Test', 'PREPARING') RETURNING id");
            batchId = newBatch.rows[0].id;
        } else {
            batchId = batchCheck.rows[0].id;
        }

        console.log(`Using Batch ID: ${batchId}`);

        // Try inserting a transaction
        // Schema check said columns: id, batch_id, wallet_address_to, amount_usdc, tx_hash, status, transaction_reference, relayer_address, updated_at
        // INSERT in code: INSERT INTO batch_transactions (batch_id, wallet_address_to, amount_usdc, transaction_reference, status)

        const insertRes = await client.query(
            'INSERT INTO batch_transactions (batch_id, wallet_address_to, amount_usdc, transaction_reference, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [batchId, '0x1234567890123456789012345678901234567890', '1000000', 'REF-TEST', 'PENDING']
        );

        console.log("✅ Insert successful:", insertRes.rows[0]);

    } catch (err) {
        console.error("❌ Insert failed:", err.message);
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

testInsert();
