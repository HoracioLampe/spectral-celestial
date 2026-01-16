require('dotenv').config();
const vault = require('../services/vault');

const faucetAddress = '0xe14b99363D029AD0E0723958a283dE0e9978D888';

async function checkVault() {
    try {
        console.log(`🔐 Verificando llave en Vault para Faucet: ${faucetAddress}`);
        console.log(`🔌 Vault URL: ${process.env.VAULT_ADDR || 'http://vault-railway-template.railway.internal:8200'}`);

        const key = await vault.getFaucetKey(faucetAddress);

        if (key) {
            console.log("✅ ¡Llave encontrada en Vault!");
            console.log(`Longitud de la llave: ${key.length} caracteres`);
        } else {
            console.log("❌ La llave NO existe en el Vault.");
            console.log("Esto confirma que la 'identidad' se perdió o nunca se guardó correctamente.");
        }
    } catch (e) {
        console.error("💥 Error crítico al consultar Vault:");
        console.error(e.message);
        if (e.message.includes('fetch failed')) {
            console.log("\n⚠️  EL VAULT ESTÁ OFFLINE O NO ES ACCESIBLE.");
            console.log("Verifica que el servicio de Vault en Railway esté levantado y 'unsealed'.");
        }
    }
}

checkVault();
