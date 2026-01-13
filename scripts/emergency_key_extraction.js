require('dotenv').config();
const vault = require('../services/vault');

const TARGET_FAUCET = "0xe14b99363D029AD0E0723958a283dE0e9978D888";

async function emergencyExtraction() {
    console.log("🚨 EMERGENCY KEY EXTRACTION STARTED");
    console.log("⏰ Waiting for Vault to unseal...\n");

    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max

    const interval = setInterval(async () => {
        attempts++;

        try {
            // Try to get the key
            const pk = await vault.getFaucetKey(TARGET_FAUCET);

            if (pk) {
                console.log("\n✅ ✅ ✅ SUCCESS! KEY EXTRACTED ✅ ✅ ✅\n");
                console.log("=".repeat(80));
                console.log(`FAUCET ADDRESS: ${TARGET_FAUCET}`);
                console.log(`PRIVATE KEY: ${pk}`);
                console.log("=".repeat(80));
                console.log("\n⚠️  COPY THIS KEY NOW AND SAVE IT SECURELY!\n");

                clearInterval(interval);
                process.exit(0);
            } else {
                process.stdout.write(`\r[${attempts}/${maxAttempts}] Vault still sealed or key not found...`);
            }
        } catch (e) {
            process.stdout.write(`\r[${attempts}/${maxAttempts}] Waiting for Vault... (${e.message.substring(0, 30)})`);
        }

        if (attempts >= maxAttempts) {
            console.log("\n\n❌ Timeout reached. Vault did not unseal in time.");
            clearInterval(interval);
            process.exit(1);
        }
    }, 5000); // Check every 5 seconds
}

emergencyExtraction();
