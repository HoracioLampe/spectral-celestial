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

    const providerUrl = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
    const provider = new ethers.JsonRpcProvider(providerUrl);

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
                console.error("❌ No faucet found in database or environment.");
                await pool.end();
                process.exit(1);
            }
            faucetWallet = new ethers.Wallet(faucetRes.rows[0].private_key, provider);
        }

        const faucetAddress = faucetWallet.address;
        console.log(`🏦 Target Faucet Address: ${faucetAddress}`);

        // 3. Fetch all relayers from DB
        const res = await pool.query('SELECT address, private_key FROM relayers');
        const relayers = res.rows;
        console.log(`🔍 Found ${relayers.length} relayers in database.`);

        // 4. Setup Gas Constants
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n;
        const gasLimit = 21000n;
        const minCost = gasLimit * gasPrice;
        const dustBuffer = ethers.parseEther("0.02");

        console.log(`⛽ Current Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
        console.log(`💰 Minimum sweep cost: ${ethers.formatEther(minCost)} MATIC`);

        // 5. Sequential Sweep (To respect 15 req/sec limit)
        let totalRescued = 0n;
        let successCount = 0;

        console.log(`⏳ Processing ${relayers.length} relayers sequentially...`);

        for (let i = 0; i < relayers.length; i++) {
            const r = relayers[i];
            try {
                process.stdout.write(`[${i + 1}/${relayers.length}] Checking ${r.address.substring(0, 10)}... `);

                const wallet = new ethers.Wallet(r.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                if (balance > (minCost + dustBuffer)) {
                    const amountToReturn = balance - minCost;
                    console.log(`✨ Sweeping ${ethers.formatEther(amountToReturn)} MATIC...`);

                    const tx = await wallet.sendTransaction({
                        to: faucetAddress,
                        value: amountToReturn,
                        gasLimit: gasLimit,
                        gasPrice: gasPrice
                    });

                    await tx.wait();
                    totalRescued += amountToReturn;
                    successCount++;
                    console.log(`   ✅ Success! Tx: ${tx.hash}`);
                } else {
                    console.log(`⏭️ Skipping (low balance: ${ethers.formatEther(balance)} MATIC)`);
                }

                // Small sleep to avoid hitting rate limits (15 req/sec)
                if (i % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (err) {
                console.log(`\n⚠️ Failed for ${r.address}: ${err.message}`);
            }
        }

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
