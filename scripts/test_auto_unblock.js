const { ethers } = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

/**
 * Test script to verify the auto-unblock functionality
 * This simulates what happens before atomic distribution
 */
async function testAutoUnblock() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    console.log(`\n🧪 Testing Auto-Unblock Functionality\n`);

    try {
        // Get the faucet wallet from database
        const result = await pool.query(`SELECT address, private_key FROM faucets ORDER BY id DESC LIMIT 1`);

        if (result.rows.length === 0) {
            throw new Error('No faucet found in database');
        }

        const { address, private_key } = result.rows[0];
        const wallet = new ethers.Wallet(private_key, provider);

        console.log(`📍 Testing Faucet: ${address}\n`);

        // Simulate the verifyAndRepairNonce function
        const verifyAndRepairNonce = async (targetWallet) => {
            try {
                const addr = targetWallet.address;
                let latestNonce = await provider.getTransactionCount(addr, "latest");
                let pendingNonce = await provider.getTransactionCount(addr, "pending");

                console.log(`[AutoRepair][${addr.substring(0, 8)}] 🔍 Nonce Check: L=${latestNonce} | P=${pendingNonce}`);

                let attempt = 0;
                const MAX_ATTEMPTS = 10;

                while (pendingNonce > latestNonce && attempt < MAX_ATTEMPTS) {
                    attempt++;
                    console.warn(`[AutoRepair][${addr.substring(0, 8)}] ⚠️ Stuck Queue Detected (Diff: ${pendingNonce - latestNonce}). Clearing slot ${latestNonce}...`);

                    const feeData = await provider.getFeeData();
                    const boostPrice = (feeData.gasPrice * 30n) / 10n; // 3x aggressive gas

                    try {
                        const tx = await targetWallet.sendTransaction({
                            to: addr,
                            value: 0,
                            nonce: latestNonce,
                            gasLimit: 30000,
                            gasPrice: boostPrice
                        });
                        console.log(`[AutoRepair][${addr.substring(0, 8)}] 💉 Correction TX Sent: ${tx.hash}. Waiting...`);

                        await Promise.race([
                            tx.wait(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 60000))
                        ]);

                        console.log(`[AutoRepair][${addr.substring(0, 8)}] ✅ Slot ${latestNonce} cleared.`);
                    } catch (txErr) {
                        console.warn(`[AutoRepair][${addr.substring(0, 8)}] ⚠️ Tx Replacement failed: ${txErr.message}. Retrying check...`);
                        await new Promise(r => setTimeout(r, 3000));
                    }

                    latestNonce = await provider.getTransactionCount(addr, "latest");
                    pendingNonce = await provider.getTransactionCount(addr, "pending");
                }

                if (pendingNonce > latestNonce) {
                    console.warn(`[AutoRepair][${addr.substring(0, 8)}] ⚠️ Queue still stuck after ${MAX_ATTEMPTS} attempts. Proceeding with caution.`);
                    return false;
                } else {
                    console.log(`[AutoRepair][${addr.substring(0, 8)}] ✨ Mempool is clean.`);
                    return true;
                }

            } catch (e) {
                console.warn(`[AutoRepair] ⚠️ Failed to auto-repair nonce: ${e.message}`);
                return false;
            }
        };

        // Run the test
        const result_repair = await verifyAndRepairNonce(wallet);

        console.log(`\n📊 Test Result:`);
        console.log(`   Auto-Unblock Status: ${result_repair ? '✅ SUCCESS' : '❌ FAILED'}`);

        // Final verification
        const finalLatest = await provider.getTransactionCount(address, "latest");
        const finalPending = await provider.getTransactionCount(address, "pending");
        const balance = await provider.getBalance(address);

        console.log(`\n📈 Final State:`);
        console.log(`   Balance: ${ethers.formatEther(balance)} POL`);
        console.log(`   Nonce Latest: ${finalLatest}`);
        console.log(`   Nonce Pending: ${finalPending}`);
        console.log(`   Difference: ${finalPending - finalLatest}`);

        if (finalPending === finalLatest) {
            console.log(`\n✅ WALLET READY - No stuck transactions`);
        } else {
            console.log(`\n⚠️ WARNING - ${finalPending - finalLatest} transaction(s) still pending`);
        }

    } catch (error) {
        console.error(`\n❌ Test failed:`, error.message);
    } finally {
        await pool.end();
    }
}

testAutoUnblock().catch(console.error);
