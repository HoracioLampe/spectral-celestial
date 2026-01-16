// Test script to verify encryption service is working
require('dotenv').config();

async function testEncryption() {
    try {
        const encryption = require('./services/encryption');

        const testKey = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

        console.log("🔒 Testing encryption...");
        const encrypted = encryption.encrypt(testKey);
        console.log("✅ Encrypted:", encrypted.substring(0, 50) + "...");

        console.log("\n🔓 Testing decryption...");
        const decrypted = encryption.decrypt(encrypted);
        console.log("✅ Decrypted:", decrypted);

        if (decrypted === testKey) {
            console.log("\n✅ ✅ ✅ ENCRYPTION SERVICE WORKING!");
        } else {
            console.log("\n❌ DECRYPTION MISMATCH!");
        }
    } catch (e) {
        console.error("❌ Error:", e.message);
        console.error("Stack:", e.stack);
    }
}

testEncryption();
