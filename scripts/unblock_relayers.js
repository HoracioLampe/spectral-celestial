require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function unblockRelayers() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const batchId = process.argv[2];
    if (!batchId) {
        console.error("Usage: node unblock_relayers.js <batchId>");
        await pool.end();
        return;
    }

    console.log(`\n🔓 UNBLOCKING RELAYERS FOR BATCH ${batchId}`);

    const provider = new ethers.JsonRpcProvider(process.env.PROVIDER_URL || "https://polygon-rpc.com");

    try {
        const res = await pool.query('SELECT address, private_key FROM relayers WHERE batch_id = $1', [batchId]);
        const relayers = res.rows;
        console.log(`Scanning ${relayers.length} relayers...`);

        let fixedCount = 0;

        for (const relayer of relayers) {
            try {
                // Check Nonces
                const latestNonce = await provider.getTransactionCount(relayer.address, 'latest');
                const pendingNonce = await provider.getTransactionCount(relayer.address, 'pending');

                if (pendingNonce > latestNonce) {
                    console.log(`\n⚠️  Stuck Relayer: ${relayer.address}`);
                    console.log(`   Nonce Gap: Latest ${latestNonce} -> Pending ${pendingNonce}`);

                    const wallet = new ethers.Wallet(relayer.private_key, provider);

                    // Fetch proper fee data
                    const feeData = await provider.getFeeData();

                    // Calculate Aggressive Gas (2.5x to be safe)
                    // Polygon often needs a high priority fee to unstuck
                    const maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas || ethers.parseUnits("30", "gwei")) * 300n / 100n;
                    const maxFeePerGas = (feeData.maxFeePerGas || ethers.parseUnits("100", "gwei")) * 300n / 100n;

                    console.log(`   🚀 Sending Replacement TX (Nonce: ${latestNonce}) with High Gas...`);
                    console.log(`      MaxPriority: ${ethers.formatUnits(maxPriorityFeePerGas, 'gwei')} Gwei`);

                    try {
                        const tx = await wallet.sendTransaction({
                            to: wallet.address, // Send to self
                            value: 0,
                            nonce: latestNonce, // REUSE NONCE
                            maxFeePerGas,
                            maxPriorityFeePerGas,
                        });

                        console.log(`      Payload Sent: ${tx.hash}`);
                        const receipt = await tx.wait();
                        console.log(`      ✅ Cleared! Block: ${receipt.blockNumber}`);
                        fixedCount++;
                    } catch (txErr) {
                        if (txErr.code === 'REPLACEMENT_UNDERPRICED') {
                            console.log("      ❌ Replacement underpriced (needs even more gas).");
                        } else {
                            console.log(`      ❌ Send Failed: ${txErr.message}`);
                        }
                    }
                }
            } catch (err) {
                console.error(`Error processing ${relayer.address}: ${err.message}`);
            }
        }

        console.log('\n---------------------------------------------------');
        console.log(`🏁 FINISHED. Unblocked: ${fixedCount} relayers.`);
        console.log('---------------------------------------------------');

    } catch (err) {
        console.error("Critical Error:", err);
    } finally {
        await pool.end();
    }
}

unblockRelayers();
