
const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
const VAULT_API_V = 'v1';

async function checkStatus() {
    const url = `${VAULT_ADDR}/${VAULT_API_V}/sys/health`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return data;
    } catch (err) {
        console.error("❌ Error conectando a Vault:", err.message);
        return null;
    }
}

async function unseal(key) {
    const url = `${VAULT_ADDR}/${VAULT_API_V}/sys/unseal`;
    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        return data;
    } catch (err) {
        console.error("❌ Error durante el unseal:", err.message);
        return null;
    }
}

async function main() {
    const keys = process.argv.slice(2);

    console.log(`🔌 Conectando a Vault en: ${VAULT_ADDR}`);

    let status = await checkStatus();
    if (!status) return;

    if (!status.initialized) {
        console.log("⚠️ Vault NO está inicializado. Debes inicializarlo primero.");
        return;
    }

    if (!status.sealed) {
        console.log("✅ Vault ya está DES-SELLADO (Unsealed).");
        return;
    }

    console.log(`🔒 Vault está SELLADO. Progreso: ${status.progress}/${status.t} (Threshold: ${status.t})`);

    if (keys.length === 0) {
        console.log("\n👉 Uso: node scripts/vault_unseal_helper.js <llave1> <llave2> ...");
        console.log("Por favor, ingresa tus llaves de unseal como argumentos.");
        return;
    }

    for (const key of keys) {
        console.log(`🔑 Aplicando llave...`);
        status = await unseal(key);
        if (!status) break;

        if (!status.sealed) {
            console.log("\n🎉 ¡Vault ha sido DES-SELLADO exitosamente!");
            break;
        } else {
            console.log(`⏳ Llave aplicada. Progreso: ${status.progress}/${status.t}`);
        }
    }

    if (status && status.sealed) {
        console.log("\n⚠️ Vault sigue sellado. Necesitas más llaves para alcanzar el threshold.");
    }
}

main();
