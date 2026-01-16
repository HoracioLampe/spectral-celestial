require('dotenv').config();
const vault = require('../services/vault');
const { ethers } = require('ethers');

async function testVaultStorage() {
    console.log("🛠️ Starting Vault Verification Script...");

    try {
        // 1. Generate Test Data
        const testWallet = ethers.Wallet.createRandom();
        console.log(`🔑 Generated Test Wallet: ${testWallet.address}`);

        // 2. Attempt Save (Using Address as Key, as per new logic)
        console.log("💾 Attempting to SAVE key to Vault...");
        const saveSuccess = await vault.saveFaucetKey(testWallet.address, testWallet.privateKey);

        if (!saveSuccess) {
            console.error("❌ FAILED to save key to Vault. Check Vault Logs/Token.");
            process.exit(1);
        }
        console.log("✅ Key SAVED successfully.");

        // 3. Attempt Retrieve
        console.log("📥 Attempting to RETRIEVE key from Vault...");
        const retrievedKey = await vault.getFaucetKey(testWallet.address);

        if (!retrievedKey) {
            console.error("❌ FAILED to retrieve key (Result was null/undefined).");
            process.exit(1);
        }

        // 4. Verify Match
        if (retrievedKey === testWallet.privateKey) {
            console.log("✅ SUCCESS: Retrieved key matches saved key exactly.");
        } else {
            console.error("❌ FAILURE: Retrieved key does NOT match saved key.");
            console.error(`   Sent: ${testWallet.privateKey.substring(0, 10)}...`);
            console.error(`   Got:  ${retrievedKey.substring(0, 10)}...`);
            process.exit(1);
        }

    } catch (err) {
        console.error("🚨 Unexpected Error:", err);
        process.exit(1);
    }
}

testVaultStorage();
