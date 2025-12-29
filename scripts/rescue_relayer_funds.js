require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function rescueFunds() {
    // Check for target faucet argument
    const faucetArgIndex = process.argv.indexOf('--faucet');
    let targetFaucetAddress = null;
    if (faucetArgIndex !== -1 && process.argv[faucetArgIndex + 1]) {
        targetFaucetAddress = process.argv[faucetArgIndex + 1];
    }

    console.log("🚀 Starting Relayer Rescue Script...");

    // 1. Setup Database & Provider
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const providerUrl = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
    const provider = new ethers.JsonRpcProvider(providerUrl, undefined, { staticNetwork: true });

    try {
        // 2. Determine target address
        if (!targetFaucetAddress) {
            console.log(`🔍 No target faucet provided via --faucet, checking DB...`);
            const faucetRes = await pool.query('SELECT address FROM faucets ORDER BY id DESC LIMIT 1');
            if (faucetRes.rows.length === 0) {
                console.error("❌ No faucet found in database. Cannot return funds.");
                await pool.end();
                process.exit(1);
            }
            targetFaucetAddress = faucetRes.rows[0].address;
        }

        console.log(`🏦 Target Faucet Address: ${targetFaucetAddress}`);

        const batchArgIndex = process.argv.indexOf('--batch');
        let batchId = null;
        if (batchArgIndex !== -1 && process.argv[batchArgIndex + 1]) {
            batchId = process.argv[batchArgIndex + 1];
        }

        let relayers = [];

        if (batchId) {
            console.log(`🎯 Targeting BATCH ID: ${batchId}`);
            const res = await pool.query("SELECT address, private_key FROM relayers WHERE batch_id = $1", [batchId]);
            relayers = res.rows;
        } else {
            console.log(`🎯 Targeting EXHAUSTIVE scan of ALL relayers in DB...`);
            const res = await pool.query("SELECT address, private_key FROM relayers");
            relayers = res.rows;
        }

        console.log(`🔍 Found ${relayers.length} relayers to process.`);

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

                try {
                    const wallet = new ethers.Wallet(r.private_key, provider);
                    const balance = await provider.getBalance(wallet.address);

                    // Leave 0.005 MATIC safety margin
                    const safetyMargin = ethers.parseEther("0.005");

                    if (balance > (minCost + safetyMargin)) {
                        const amountToReturn = balance - minCost;

                        console.log(`✨ [${wallet.address.substring(0, 8)}] Balance: ${ethers.formatEther(balance)} MATIC | Sweeping: ${ethers.formatEther(amountToReturn)}`);

                        const tx = await wallet.sendTransaction({
                            to: targetFaucetAddress,
                            value: amountToReturn,
                            gasLimit: gasLimit,
                            gasPrice: boostedGasPrice
                        });

                        await tx.wait();
                        console.log(`   ✅ Confirmed: ${tx.hash}`);
                        totalRescued += amountToReturn;
                        successCount++;
                        await pool.query('UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE address = $2', ['0', r.address]);
                    } else {
                        // Mark as zero in DB if below sweep threshold
                        await pool.query('UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE address = $2', [ethers.formatEther(balance), r.address]);
                    }
                } catch (err) {
                    console.log(`   ⚠️ Failed for ${r.address.substring(0, 8)}: ${err.message.substring(0, 80)}`);
                }

                processedCount++;
                if (processedCount % 5 === 0) console.log(`📊 Progress: ${processedCount}/${relayers.length}`);
            }
        };

        const workers = Array(Math.min(concurrency, relayers.length)).fill(null).map(() => worker());
        await Promise.all(workers);

        console.log("\n--- Summary ---");
        console.log(`💎 Total Rescued: ${ethers.formatEther(totalRescued)} MATIC to ${targetFaucetAddress}`);

    } catch (err) {
        console.error("❌ Error:", err);
    } finally {
        await pool.end();
    }
}

rescueFunds();
