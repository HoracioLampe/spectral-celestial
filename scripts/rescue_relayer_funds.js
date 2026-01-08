require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function rescueFunds() {
    // Check for target faucet argument OVERRIDE
    const faucetArgIndex = process.argv.indexOf('--faucet');
    let overrideFaucet = null;
    if (faucetArgIndex !== -1 && process.argv[faucetArgIndex + 1]) {
        overrideFaucet = process.argv[faucetArgIndex + 1];
        console.log(`⚠️ FORCE OVERRIDE: Sending ALL funds to ${overrideFaucet}`);
    }

    console.log("🚀 Starting Relayer Rescue Script (Funder-Aware)...");

    // 1. Setup Database & Provider
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const providerUrl = process.env.RPC_URL || process.env.PROVIDER_URL || "https://polygon-rpc.com";
    const provider = new ethers.JsonRpcProvider(providerUrl, undefined, { staticNetwork: true });

    try {
        const batchArgIndex = process.argv.indexOf('--batch');
        let batchId = null;
        if (batchArgIndex !== -1 && process.argv[batchArgIndex + 1]) {
            batchId = parseInt(process.argv[batchArgIndex + 1]);
        }

        let relayers = [];

        // UPDATED QUERY: Join Batches and Faucets to get correct return address
        const querySelect = `
            SELECT 
                r.address, 
                r.private_key as db_private_key,
                f.address as faucet_address,
                b.id as batch_id
            FROM relayers r
            LEFT JOIN batches b ON r.batch_id = b.id
            LEFT JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
        `;

        if (batchId) {
            console.log(`🎯 Targeting BATCH ID: ${batchId}`);
            const res = await pool.query(`${querySelect} WHERE r.batch_id = $1`, [batchId]);
            relayers = res.rows;
        } else {
            console.log(`🎯 Targeting FULL HISTORY scan (Last 1000 batches)...`);
            const res = await pool.query(`
                ${querySelect} 
                WHERE r.batch_id IN (
                    SELECT id FROM batches ORDER BY id DESC LIMIT 1000
                )
            `);
            relayers = res.rows;
        }

        console.log(`🔍 Found ${relayers.length} relayers to process.`);

        // REMOVED: global fallback logic to ensure isolation
        let globalFallback = null;

        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n;
        const boostedGasPrice = (gasPrice * 130n) / 100n; // 30% boost for speed
        const gasLimit = 21000n;
        const minCost = gasLimit * boostedGasPrice;

        console.log(`⛽ Gas Price: ${ethers.formatUnits(boostedGasPrice, 'gwei')} gwei`);
        console.log(`💰 Safe sweep cost: ${ethers.formatEther(minCost)} MATIC`);

        let totalRescued = 0n;
        let successCount = 0;
        const concurrency = 5;
        const queue = [...relayers];
        let processedCount = 0;

        const worker = async () => {
            while (queue.length > 0) {
                const r = queue.shift();
                if (!r) continue;

                // Determine Target - STRICT isolation
                let targetTo = overrideFaucet || r.faucet_address;

                if (!targetTo) {
                    console.error(`❌ Skipping ${r.address}: No target faucet found.`);
                    continue;
                }

                try {
                    const vault = require('../services/vault');
                    let pk = await vault.getRelayerKey(r.address);

                    if (!pk && r.db_private_key && r.db_private_key !== 'VAULT_SECURED') {
                        pk = r.db_private_key;
                        console.log(`   🔸 [${r.address.substring(0, 6)}] Using key from Database (Vault fallback)`);
                    }

                    if (!pk) throw new Error("Key not found in Vault or DB");
                    const wallet = new ethers.Wallet(pk, provider);
                    const balance = await provider.getBalance(wallet.address);

                    // Increase safety margin to 0.1 MATIC
                    const safetyMargin = ethers.parseEther("0.1");

                    if (balance > (minCost + safetyMargin)) {
                        let amountToReturn = balance - minCost - safetyMargin;

                        console.log(`✨ [${wallet.address.substring(0, 6)}..] Balance: ${ethers.formatEther(balance)} | Target: ${targetTo.substring(0, 6)}..`);

                        try {
                            const tx = await wallet.sendTransaction({
                                to: targetTo,
                                value: amountToReturn,
                                gasLimit: gasLimit,
                                gasPrice: boostedGasPrice
                            });
                            await tx.wait();
                            console.log(`   ✅ Confirmed: ${tx.hash}`);
                            totalRescued += amountToReturn;
                            successCount++;
                            await pool.query("UPDATE relayers SET last_balance = $1, last_activity = NOW(), status = 'drained' WHERE address = $2", ['0', r.address]);
                        } catch (txErr) {
                            if (txErr.code === 'INSUFFICIENT_FUNDS' || txErr.message.includes('insufficient funds')) {
                                console.warn(`   ⚠️ Insufficient Funds (Queued/Dust). Retrying with 50%...`);
                                try {
                                    const safeAmount = amountToReturn / 2n;
                                    const tx2 = await wallet.sendTransaction({
                                        to: targetTo,
                                        value: safeAmount,
                                        gasLimit: gasLimit,
                                        gasPrice: boostedGasPrice
                                    });
                                    await tx2.wait();
                                    console.log(`   ✅ Confirmed (50% Fallback): ${tx2.hash}`);
                                    totalRescued += safeAmount;
                                } catch (fallbackErr) {
                                    console.error(`   ❌ Fallback failed`);
                                }
                            } else {
                                throw txErr;
                            }
                        }

                    } else {
                        // Mark as zero in DB
                        await pool.query("UPDATE relayers SET last_balance = $1, last_activity = NOW(), status = 'drained' WHERE address = $2", [ethers.formatEther(balance), r.address]);
                    }
                } catch (err) {
                    console.log(`   ⚠️ Failed for ${r.address.substring(0, 8)}: ${err.message.substring(0, 50)}`);
                }

                processedCount++;
                if (processedCount % 10 === 0) console.log(`📊 Progress: ${processedCount}/${relayers.length}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        };

        const workers = Array(Math.min(concurrency, relayers.length)).fill(null).map(() => worker());
        await Promise.all(workers);

        console.log("\n--- Summary ---");
        console.log(`💎 Total Rescued: ${ethers.formatEther(totalRescued)} MATIC`);

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await pool.end();
    }
}

rescueFunds();
