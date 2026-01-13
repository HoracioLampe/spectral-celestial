const vault = require('../services/vault');
require('dotenv').config();

async function listVaultKeys() {
    const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
    const VAULT_TOKEN = process.env.VAULT_TOKEN;
    const MOUNT_POINT = 'secret';

    console.log(`🔌 Conectando a Vault en: ${VAULT_ADDR}`);

    if (!VAULT_TOKEN) {
        console.error("❌ VAULT_TOKEN no encontrado en el entorno.");
        return;
    }

    const headers = {
        'X-Vault-Token': VAULT_TOKEN,
        'Content-Type': 'application/json'
    };

    try {
        // List keys in KV v2: mount/metadata/path
        console.log("📂 Listando llaves en secret/metadata/faucets/ ...");
        const res = await fetch(`${VAULT_ADDR}/v1/${MOUNT_POINT}/metadata/faucets?list=true`, {
            method: 'GET',
            headers
        });

        if (res.ok) {
            const data = await res.json();
            console.log("✅ Llaves encontradas:");
            console.log(JSON.stringify(data.data.keys, null, 2));
        } else {
            const errText = await res.text();
            console.warn(`⚠️  No se pudieron listar las llaves (Status: ${res.status})`);
            console.warn(`Respuesta: ${errText}`);
            if (res.status === 404) {
                console.log("👉 El path 'faucets/' parece estar totalmente VACÍO. Esto confirma la pérdida de storage.");
            }
        }
    } catch (e) {
        console.error("💥 Error de conexión al intentar listar:");
        console.error(e.message);
    }
}

listVaultKeys();
