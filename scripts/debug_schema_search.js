const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const b = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'batches'");
        console.log('Batches Columns:', b.rows.map(r => r.column_name));

        const bt = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'batch_transactions'");
        console.log('Batch Transactions Columns:', bt.rows.map(r => r.column_name));

        const address = '0x7363d49c0ef0ae66ba7907f42932c340136d714f'.toLowerCase();

        // Search in batches
        const batchesSearch = await pool.query("SELECT * FROM batches WHERE funder_address = $1", [address]);
        if (batchesSearch.rows.length > 0) {
            console.log("Encontrado en batches (funder_address):");
            console.table(batchesSearch.rows);
        } else {
            console.log("No encontrado en batches (funder_address).");
        }

        // Search in batch_transactions
        const btSearchRelayer = await pool.query("SELECT * FROM batch_transactions WHERE relayer_address = $1", [address]);
        if (btSearchRelayer.rows.length > 0) {
            console.log("Encontrado en batch_transactions (relayer_address):");
            console.table(btSearchRelayer.rows);
        } else {
            console.log("No encontrado en batch_transactions (relayer_address).");
        }

        const btSearchRecipient = await pool.query("SELECT * FROM batch_transactions WHERE wallet_address_to = $1", [address]);
        if (btSearchRecipient.rows.length > 0) {
            console.log("Encontrado en batch_transactions (wallet_address_to):");
            console.table(btSearchRecipient.rows);
        } else {
            console.log("No encontrado en batch_transactions (wallet_address_to).");
        }

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
run();
