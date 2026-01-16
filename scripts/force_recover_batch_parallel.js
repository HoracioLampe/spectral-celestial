require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function recoverBatchFundsParallel() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const batchId = process.argv[2];
    const explicitTarget = process.argv[3];

    if (!batchId || !explicitTarget) {
        console.error("Usage: node force_recover_batch_parallel.js <batchId> <targetFaucetAddress>");
        await pool.end();
        return;
    }

    console.log(`\n🚑 STARTING PARALLEL RECOVERY FOR BATCH ${batchId}`);
    console.log(`🎯 TARGET FAUCET: ${explicitTarget}`);
    console.log('---------------------------------------------------');

    const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL || "https://polygon-rpc.com");

    try {
        // 1. Get Relayers
        const res = await pool.query('SELECT address, private_key FROM relayers WHERE batch_id = $1', [batchId]);
        const relayers = res.rows;
        console.log(`Found ${relayers.length} relayers for batch ${batchId}.`);

        let totalRecovered = 0n;
        let successCount = 0;
        let failCount = 0;

        // Process all relayers in parallel
        const recoveryPromises = relayers.map(async (relayer) => {
            try {
                const wallet = new ethers.Wallet(relayer.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                // Keep 0.05 MATIC for gas (safer buffer)
                const gasBuffer = ethers.parseEther("0.05");

                if (balance > gasBuffer) {
                    const valueToSend = balance - gasBuffer;
                    console.log(`\n⚡ Processing ${wallet.address}...`);
                    console.log(`   Balance: ${ethers.formatEther(balance)} | Sending: ${ethers.formatEther(valueToSend)}`);

                    const tx = await wallet.sendTransaction({
                        to: explicitTarget,
                        value: valueToSend
                    });

                    console.log(`   ✅ TX Sent: ${tx.hash}`);
                    const receipt = await tx.wait();
                    console.log(`   Confirmed (Block: ${receipt.blockNumber})`);

                    // Mark as drained in DB
                    await pool.query("UPDATE relayers SET status = 'drained', last_balance = '0' WHERE address = $1", [wallet.address]);

                    return { success: true, amount: valueToSend };
                } else {
                    console.log(`⏭️  Skipping ${wallet.address} (Low Balance: ${ethers.formatEther(balance)})`);
                    return { success: true, amount: 0n };
                }
            } catch (err) {
                console.error(`❌ Failed to recover from ${relayer.address}:`, err.message);
                return { success: false, amount: 0n };
            }
        });

        // Wait for all recoveries to complete
        const results = await Promise.all(recoveryPromises);

        // Aggregate results
        results.forEach(result => {
            if (result.success) {
                successCount++;
                totalRecovered += result.amount;
            } else {
                failCount++;
            }
        });

        console.log('\n---------------------------------------------------');
        console.log(`🏁 RECOVERY COMPLETE`);
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed:     ${failCount}`);
        console.log(`💰 Total Recovered: ${ethers.formatEther(totalRecovered)} MATIC`);
        console.log('---------------------------------------------------');

    } catch (err) {
        console.error("Critical Error:", err);
    } finally {
        await pool.end();
    }
}

recoverBatchFundsParallel();
