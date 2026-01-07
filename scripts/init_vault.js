
const { ethers } = require('ethers');
// Native fetch is available in Node > 18.
// If using older node, we might need 'node-fetch', but let's assume standard environment.

const VAULT_APIV = 'v1';

async function initVault(vaultUrl) {
    if (!vaultUrl) {
        console.error("❌ Usage: node scripts/init_vault.js <VAULT_URL>");
        process.exit(1);
    }

    // Clean URL
    const baseUrl = vaultUrl.replace(/\/$/, '');
    console.log(`🔌 Connecting to Vault at: ${baseUrl}`);

    try {
        // 1. Check Initialization Status
        const initStatusReq = await fetch(`${baseUrl}/${VAULT_APIV}/sys/init`);
        const initStatus = await initStatusReq.json();

        if (initStatus.initialized) {
            console.log("⚠️  Vault is ALREADY initialized.");
            console.log("👉 If you don't have the keys, you need to wipe the volume in Railway and restart.");
            return;
        }

        console.log("🚀 Vault is NOT initialized. Starting initialization...");

        // 2. Initialize
        // We request 5 shares, threshold 3 (standard security)
        const initPayload = {
            secret_shares: 5,
            secret_threshold: 3
        };

        const initReq = await fetch(`${baseUrl}/${VAULT_APIV}/sys/init`, {
            method: 'PUT',
            body: JSON.stringify(initPayload),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!initReq.ok) {
            throw new Error(`Init failed: ${initReq.status} ${initReq.statusText}`);
        }

        const keys = await initReq.json();

        console.log("\n✅ VAULT INITIALIZED SUCCESSFULLY!");
        console.log("==================================================================");
        console.log("🔑 ROOT TOKEN (Save this securely!):");
        console.log(keys.root_token);
        console.log("\n🗝️  UNSEAL KEYS (You need 3 of these to restart Vault):");
        keys.keys.forEach((k, i) => console.log(`   ${i + 1}: ${k}`));
        console.log("==================================================================");

        // 3. Unseal (Auto-Unseal for convenience now)
        console.log("\n🔓 Attempting to Unseal now...");

        for (let i = 0; i < 3; i++) {
            const unsealReq = await fetch(`${baseUrl}/${VAULT_APIV}/sys/unseal`, {
                method: 'PUT',
                body: JSON.stringify({ key: keys.keys_base64 ? keys.keys_base64[i] : keys.keys[i] }),
                headers: { 'Content-Type': 'application/json' }
            });
            const unsealData = await unsealReq.json();
            console.log(`   Unseal Key ${i + 1} applied. Sealed: ${unsealData.sealed}`);
            if (!unsealData.sealed) {
                console.log("🎉 Vault is UNSEALED and ready to use!");
                break;
            }
        }

    } catch (err) {
        console.error("❌ Error:", err.message);
        if (err.cause) console.error(err.cause);
    }
}

const urlArg = process.argv[2];
initVault(urlArg);
