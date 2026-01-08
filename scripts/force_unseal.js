
const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
const VAULT_API_V = 'v1';

const keys = [
    "91cff7e6257c8b907c27d148bdcc47ed10debdc07198d83a0c9d96637b08d8e3de",
    "7976895694facfe726722e9a1bd24a9eececee3a15a2bcb0a7b7c0e2f408480f75",
    "1ca49cb68f1cd25dbb753ce408714ef74964a96b75db228faadf42ee7a37ad14ca"
];

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
    console.log(`🔌 Intentando des-sellar Vault internamente en: ${VAULT_ADDR}`);

    for (let i = 0; i < keys.length; i++) {
        console.log(`🔑 Aplicando llave ${i + 1}...`);
        const status = await unseal(keys[i]);
        if (!status) {
            console.error("❌ Falló la conexión con Vault.");
            return;
        }

        if (!status.sealed) {
            console.log("\n🎉 ¡Vault ha sido DES-SELLADO exitosamente!");
            return;
        } else {
            console.log(`⏳ Llave aplicada. Progreso: ${status.progress}/${status.t}`);
        }
    }
}

main();
