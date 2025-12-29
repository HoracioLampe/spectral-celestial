require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function rescueFunds() {
    console.log("🚀 Starting Relayer Rescue Script...");

    // 1. Setup Database & Provider
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    // Chainstack L2 RPC
    const providerUrl = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
    const provider = new ethers.JsonRpcProvider(providerUrl, undefined, { staticNetwork: true });

    try {
        let faucetWallet;

        // 2. Setup Faucet Wallet (Priority: ENV > DB)
        if (process.env.FAUCET_PRIVATE_KEY) {
            console.log(`🏦 Using Faucet from ENV.`);
            faucetWallet = new ethers.Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
        } else {
            console.log(`🔍 No Faucet in ENV, checking DB...`);
            const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
            if (faucetRes.rows.length === 0) {
                console.error("❌ No faucet found in database or environment. Cannot return funds.");
                await pool.end();
                process.exit(1);
            }
            faucetWallet = new ethers.Wallet(faucetRes.rows[0].private_key, provider);
        }

        const faucetAddress = faucetWallet.address;
        console.log(`🏦 Target Faucet Address: ${faucetAddress}`);

        const targetAddress = process.argv[2]; // Optional: specific address to rescue
        const batchArgIndex = process.argv.indexOf('--batch');
        let batchId = null;
        if (batchArgIndex !== -1 && process.argv[batchArgIndex + 1]) {
            batchId = process.argv[batchArgIndex + 1];
        }

        let relayers = [];

        if (batchId) {
            console.log(`🎯 Targeting BATCH ID: ${batchId}`);
            // Fetch ALL relayers for this batch, ignore last_balance check to ensure we check on-chain
            const res = await pool.query("SELECT address, private_key, last_balance FROM relayers WHERE batch_id = $1", [batchId]);
            relayers = res.rows;
        } else if (targetAddress && targetAddress.startsWith('0x')) {
            console.log(`🎯 Targeting specific relayer: ${targetAddress}`);
            const res = await pool.query("SELECT address, private_key FROM relayers WHERE address = $1", [targetAddress]);
            relayers = res.rows;
        } else {
            // 3. Fetch ALL relayers to handle DB/On-chain desync (Checking all 800)
            const res = await pool.query("SELECT address, private_key, last_balance FROM relayers");
            relayers = res.rows;
        }

        console.log(`🔍 Found ${relayers.length} relayers to process.`);

        // 4. Setup Gas Constants
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n;
        const gasLimit = 21000n;
        const minCost = gasLimit * gasPrice;
        const dustBuffer = ethers.parseEther("0.0"); // Set to 0 to sweep everything above gas cost

        console.log(`⛽ Current Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
        console.log(`💰 Minimum sweep cost: ${ethers.formatEther(minCost)} MATIC`);

        // 5. Sequential Sweep (To respect 15 req/sec limit)
        let totalRescued = 0n;
        let successCount = 0;

        console.log(`⏳ Processing ${relayers.length} relayers in parallel (Concurrency: 15)...`);

        const concurrency = 3;
        const maxRetries = 3;
        const queue = [...relayers];
        let processedCount = 0;

        console.log(`⏳ Processing ${relayers.length} relayers with Concurrency: ${concurrency} and Retries...`);

        const worker = async () => {
            while (queue.length > 0) {
                const r = queue.shift();
                if (!r) continue;

                let attempts = 0;
                let success = false;

                while (attempts < maxRetries && !success) {
                    try {
                        const wallet = new ethers.Wallet(r.private_key, provider);
                        const balance = await provider.getBalance(wallet.address);

                        if (balance > (minCost + dustBuffer)) {
                            const amountToReturn = balance - minCost;

                            if (attempts > 0) {
                                console.log(`   🔄 [Retry ${attempts}] ${wallet.address.substring(0, 8)}...`);
                            } else {
                                console.log(`✨ [${wallet.address.substring(0, 8)}] Balance: ${ethers.formatEther(balance)} MATIC`);
                            }

                            const tx = await wallet.sendTransaction({
                                to: faucetAddress,
                                value: amountToReturn,
                                gasLimit: gasLimit,
                                gasPrice: gasPrice
                            });

                            console.log(`   🚀 Broadcasted: ${tx.hash}. Waiting for confirmation...`);
                            const receipt = await tx.wait();

                            if (receipt.status === 1) {
                                console.log(`   ✅ Confirmed! Sweep successful.`);
                                totalRescued += amountToReturn;
                                successCount++;
                                success = true;
                                // Update DB only on actual success
                                await pool.query('UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE address = $2', ['0', r.address]);
                            } else {
                                throw new Error("Transaction reverted on-chain");
                            }
                        } else {
                            // Already empty or dust
                            success = true;
                            if (parseFloat(r.last_balance || '0') > 0) {
                                await pool.query('UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE address = $2', [ethers.formatEther(balance), r.address]);
                            }
                        }
                    } catch (err) {
                        attempts++;
                        console.log(`   ⚠️ Error for ${r.address} (Attempt ${attempts}): ${err.message}`);
                        if (attempts < maxRetries) {
                            const waitTime = attempts * 2000;
                            await new Promise(res => setTimeout(res, waitTime));
                        }
                    }
                }
                processedCount++;
                if (processedCount % 5 === 0 || processedCount === relayers.length) {
                    console.log(`📊 Progress: ${processedCount}/${relayers.length} relayers processed.`);
                }
            }
        };

        // Start workers
        const workers = Array(Math.min(concurrency, relayers.length || 0)).fill(null).map(() => worker());
        await Promise.all(workers);

        console.log("\n--- Rescue Summary ---");
        console.log(`✅ Relayers Processed: ${relayers.length}`);
        console.log(`💰 Total Successful Sweeps: ${successCount}`);
        console.log(`💎 Total MATIC Rescued: ${ethers.formatEther(totalRescued)} MATIC`);

    } catch (err) {
        console.error("❌ Critical Error:", err);
    } finally {
        await pool.end();
    }
}

rescueFunds();
