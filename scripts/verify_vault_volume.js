require('dotenv').config();
const vault = require('../services/vault');

const TARGET_ADDRESS = "0xe14b99363D029AD0E0723958a283dE0e9978D888";

async function verifyVaultData() {
    console.log("🔍 VAULT DATA VERIFICATION");
    console.log("=".repeat(60));

    try {
        // 1. Check Vault health
        const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
        const healthRes = await fetch(`${VAULT_ADDR}/v1/sys/health`);
        const health = await healthRes.json();

        console.log("\n📊 Vault Status:");
        console.log(`   Initialized: ${health.initialized}`);
        console.log(`   Sealed: ${health.sealed}`);
        console.log(`   Version: ${health.version}`);

        if (!health.initialized) {
            console.log("\n❌ Vault is NOT initialized - this is a fresh/empty vault");
            console.log("   Your data is NOT here.");
            process.exit(1);
        }

        if (health.sealed) {
            console.log("\n🔓 Attempting to unseal...");
            await vault.ensureUnsealed();
        }

        // 2. Try to read the target key
        console.log(`\n🔑 Looking for key: ${TARGET_ADDRESS}`);
        const pk = await vault.getFaucetKey(TARGET_ADDRESS);

        if (pk) {
            console.log("\n✅ ✅ ✅ SUCCESS! DATA FOUND! ✅ ✅ ✅");
            console.log("=".repeat(60));
            console.log(`Address: ${TARGET_ADDRESS}`);
            console.log(`Private Key: ${pk}`);
            console.log("=".repeat(60));
            console.log("\n⚠️  COPY THIS KEY NOW AND SAVE IT SECURELY!");
        } else {
            console.log("\n❌ Key NOT found in this vault");
            console.log("   This vault does NOT contain your data.");
        }

    } catch (e) {
        console.error("\n❌ Error:", e.message);
        console.log("\nThis vault is either:");
        console.log("  1. Not accessible");
        console.log("  2. Empty/new");
        console.log("  3. Has wrong unseal keys");
    }
}

verifyVaultData();
