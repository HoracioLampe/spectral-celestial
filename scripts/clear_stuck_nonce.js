
const { ethers } = require('ethers');
require('dotenv').config();

// User provided key (TEMPORARY FOR RESCUE)
const USER_KEY = "0x81091b2d5f240b671012b2fc90a2dd14ae31924572961ceb2c7db3a3e7480a65";

async function clearStuckNonce() {
    // Setup Provider
    // Using a reliable public RPC if env is missing, or the one from previous context
    const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.infura.io/v3/b55365e886984da6b7858c8945781a80";
    const provider = new ethers.JsonRpcProvider(providerUrl);

    try {
        const wallet = new ethers.Wallet(USER_KEY, provider);
        const address = wallet.address;
        console.log(`👤 Wallet: ${address}`);

        let latestNonce = await provider.getTransactionCount(address, "latest");
        let pendingNonce = await provider.getTransactionCount(address, "pending");

        console.log(`🔢 Initial Nonce Status: L=${latestNonce} | P=${pendingNonce}`);

        let attempt = 0;
        const MAX = 10;

        while (pendingNonce > latestNonce && attempt < MAX) {
            attempt++;
            console.log(`⚠️ Cleaning slot ${latestNonce} (queued: ${pendingNonce - latestNonce} left)...`);

            const feeData = await provider.getFeeData();
            const boostPrice = (feeData.gasPrice * 30n) / 10n;

            try {
                const tx = await wallet.sendTransaction({
                    to: address,
                    value: 0,
                    nonce: latestNonce,
                    gasLimit: 30000,
                    gasPrice: boostPrice
                });
                console.log(`✅ Replacement Sent: ${tx.hash}`);
                await tx.wait();
                console.log(`🎉 Slot cleared.`);
            } catch (e) {
                console.error(`❌ Failed to clear slot:`, e.message);
                // Break or retry? keep looping to check status
            }

            // Refresh
            latestNonce = await provider.getTransactionCount(address, "latest");
            pendingNonce = await provider.getTransactionCount(address, "pending");
        }

        console.log(`🏁 Final Status: L=${latestNonce} | P=${pendingNonce}`);
        if (pendingNonce === latestNonce) {
            console.log(`✅✅ QUEUE CLEARED! System is ready.`);
        } else {
            console.error(`❌ Still stuck after ${MAX} attempts.`);
        }

    } catch (err) {
        console.error("Critical Failure:", err);
    }
}

clearStuckNonce();
