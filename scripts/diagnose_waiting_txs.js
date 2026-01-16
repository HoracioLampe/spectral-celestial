require('dotenv').config();
const { Pool } = require('pg');
const ethers = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9");

async function diagnoseWaitingTransactions() {
    console.log("🔍 Diagnosing WAITING FOR CONFIRMATION transactions...\n");

    try {
        // Get all WAITING transactions
        const res = await pool.query(`
            SELECT id, tx_hash, relayer_address, status, updated_at, batch_id
            FROM batch_transactions
            WHERE status = 'WAITING_CONFIRMATION'
            ORDER BY updated_at ASC
            LIMIT 10
        `);

        console.log(`📊 Found ${res.rowCount} WAITING transactions (showing first 10)\n`);

        if (res.rows.length === 0) {
            console.log("✅ No WAITING transactions found!");
            return;
        }

        for (const tx of res.rows) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`📝 TX ID: ${tx.id}`);
            console.log(`📦 Batch ID: ${tx.batch_id}`);
            console.log(`🔗 Hash: ${tx.tx_hash}`);
            console.log(`👛 Relayer: ${tx.relayer_address}`);
            console.log(`🔄 Updated: ${tx.updated_at}`);

            if (!tx.tx_hash) {
                console.log("⚠️  No tx_hash - transaction never sent!");
                continue;
            }

            try {
                // Check transaction on-chain
                const receipt = await provider.getTransactionReceipt(tx.tx_hash);

                if (receipt) {
                    console.log(`✅ CONFIRMED on-chain!`);
                    console.log(`   Block: ${receipt.blockNumber}`);
                    console.log(`   Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);
                    console.log(`   ⚠️  DB is OUT OF SYNC - should be marked as ${receipt.status === 1 ? 'COMPLETED' : 'FAILED'}`);
                } else {
                    // Not mined yet, check if still pending
                    const pendingTx = await provider.getTransaction(tx.tx_hash);

                    if (pendingTx) {
                        console.log(`⏳ Still PENDING in mempool`);
                        console.log(`   Nonce: ${pendingTx.nonce}`);
                        console.log(`   Gas Price: ${ethers.formatUnits(pendingTx.gasPrice || pendingTx.maxFeePerGas, 'gwei')} gwei`);

                        // Check current network gas price
                        const feeData = await provider.getFeeData();
                        const currentGasPrice = ethers.formatUnits(feeData.gasPrice, 'gwei');
                        console.log(`   Network Gas: ${currentGasPrice} gwei`);

                        const txGas = parseFloat(ethers.formatUnits(pendingTx.gasPrice || pendingTx.maxFeePerGas, 'gwei'));
                        const networkGas = parseFloat(currentGasPrice);

                        if (txGas < networkGas * 0.8) {
                            console.log(`   ❌ GAS TOO LOW! TX gas is ${((txGas / networkGas) * 100).toFixed(1)}% of network gas`);
                        }
                    } else {
                        console.log(`❌ NOT FOUND on-chain!`);
                        console.log(`   Transaction was dropped or never broadcast`);
                        console.log(`   Possible causes:`);
                        console.log(`   - Nonce was replaced by another transaction`);
                        console.log(`   - RPC error during broadcast`);
                        console.log(`   - Transaction expired from mempool (gas too low)`);
                    }
                }
            } catch (err) {
                console.log(`❌ RPC Error: ${err.message}`);
            }
        }

        console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📊 SUMMARY`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

        // Get count by status
        const summary = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM batch_transactions
            WHERE batch_id IN (
                SELECT DISTINCT batch_id FROM batch_transactions WHERE status = 'WAITING_CONFIRMATION'
            )
            GROUP BY status
            ORDER BY count DESC
        `);

        summary.rows.forEach(row => {
            console.log(`${row.status}: ${row.count}`);
        });

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await pool.end();
    }
}

diagnoseWaitingTransactions();
