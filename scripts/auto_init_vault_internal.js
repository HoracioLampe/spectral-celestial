
const { ethers } = require('ethers');

// INTERNAL RAILWAY URL (from your screenshot)
// Port 8200 is standard for Vault
const INTERNAL_VAULT_URL = "http://vault-railway-template.railway.internal:8200";
const VAULT_APIV = 'v1';

async function autoInit() {
    console.log(`🤖 AUTO-INIT: Attempting to connect to Vault internally at ${INTERNAL_VAULT_URL}...`);

    try {
        // 1. Check if Vault is reachable
        let initStatusReq;
        try {
            initStatusReq = await fetch(`${INTERNAL_VAULT_URL}/${VAULT_APIV}/sys/init`);
        } catch (netErr) {
            console.error(`❌ Connection Failed: Could not reach Vault at ${INTERNAL_VAULT_URL}`);
            console.error("   Make sure the Service Name is exactly 'vault-railway-template' and port is 8200.");
            return;
        }

        const initStatus = await initStatusReq.json();

        if (initStatus.initialized) {
            console.log("⚠️  Vault is ALREADY initialized.");
            console.log("   If you lost the tokens, you must delete the Vault service and redeploy.");
            return;
        }

        console.log("🚀 Vault is Uninitialized. Proceeding with initialization...");

        // 2. Initialize (5 shares, 3 threshold)
        const initPayload = { secret_shares: 5, secret_threshold: 3 };

        const initReq = await fetch(`${INTERNAL_VAULT_URL}/${VAULT_APIV}/sys/init`, {
            method: 'PUT',
            body: JSON.stringify(initPayload),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!initReq.ok) {
            throw new Error(`Init failed: ${initReq.status} ${initReq.statusText}`);
        }

        const keys = await initReq.json();

        console.log("\n🛑🛑🛑 SECURITY ALERT: SAVE THESE KEYS NOW! 🛑🛑🛑");
        console.log("They will only resolve ONCE in these logs.");
        console.log("==================================================================");
        console.log("🔑 ROOT TOKEN:");
        console.log(keys.root_token);
        console.log("\n🗝️  UNSEAL KEYS (Need 3 to unlock):");
        keys.keys.forEach((k, i) => console.log(`   Key ${i + 1}: ${k}`));
        console.log("==================================================================");

        // 3. Auto-Unseal (Best effort)
        console.log("🔓 Attempting to Unseal automatically...");
        for (let i = 0; i < 3; i++) {
            await fetch(`${INTERNAL_VAULT_URL}/${VAULT_APIV}/sys/unseal`, {
                method: 'PUT',
                body: JSON.stringify({ key: keys.keys[i] }),
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`   Key ${i + 1} applied.`);
        }
        console.log("✅ Auto-Unseal Sequence Complete. Vault should be ready.");

    } catch (err) {
        console.error("❌ Error during Auto-Init:", err.message);
    }
}

autoInit();
