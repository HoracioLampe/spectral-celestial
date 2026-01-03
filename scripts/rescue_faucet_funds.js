require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

async function rescueFaucetFunds() {
    try {
        const rawTarget = process.argv[2] || process.env.ADMIN_WALLET;
        if (!rawTarget) {
            throw new Error("ADMIN_WALLET environment variable is not set and no target address provided as argument.");
        }
        const targetWallet = ethers.getAddress(rawTarget.toLowerCase().trim());
        console.log(`🚀 Starting Faucet Rescue Script...`);
        console.log(`🎯 Target Wallet: ${targetWallet}`);

        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const provider = new ethers.JsonRpcProvider(providerUrl, undefined, { staticNetwork: true });

        try {
            const res = await pool.query('SELECT address, private_key FROM faucets');
            const faucets = res.rows;
            console.log(`🔍 Found ${faucets.length} faucets to process.`);

            const feeData = await provider.getFeeData();
            const gasPrice = (feeData.gasPrice * 180n) / 100n; // 80% boost for safety
            const gasLimit = 21000n;
            const minCost = gasLimit * gasPrice;

            let totalRescued = 0n;

            for (const f of faucets) {
                try {
                    const cleanFaucetAddress = ethers.getAddress(f.address.toLowerCase().trim());
                    const wallet = new ethers.Wallet(f.private_key, provider);
                    const balance = await provider.getBalance(cleanFaucetAddress);

                    if (balance > minCost) {
                        const amountToReturn = balance - minCost;
                        console.log(`✨ [${cleanFaucetAddress.substring(0, 8)}] Balance: ${ethers.formatEther(balance)} MATIC`);

                        const tx = await wallet.sendTransaction({
                            to: targetWallet,
                            value: amountToReturn,
                            gasLimit,
                            gasPrice
                        });

                        console.log(`   ✅ Sent: ${tx.hash}`);
                        await tx.wait();
                        totalRescued += amountToReturn;
                    } else {
                        console.log(`   ℹ️ [${cleanFaucetAddress.substring(0, 8)}] Balance too low: ${ethers.formatEther(balance)}`);
                    }
                } catch (err) {
                    console.error(`   ❌ Error rescuing from ${f.address}: ${err.message}`);
                }
            }

            console.log("\n--- Summary ---");
            console.log(`💎 Total Rescued from Faucets: ${ethers.formatEther(totalRescued)} MATIC`);

        } catch (err) {
            console.error("❌ Critical Error:", err);
        } finally {
            await pool.end();
        }
    } catch (outerErr) {
        console.error("❌ Target Wallet Normalization Error:", outerErr.message);
    }
}

rescueFaucetFunds();
