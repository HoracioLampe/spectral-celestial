{
  "message": "2026-01-13 01:57:38.626 UTC [66450] STATEMENT:  SELECT address, funder_address, status FROM faucets",
  "attributes": {
    "level": "error"
  },
  "tags": {
    "project": "bc3c2546-4259-4cbc-9d39-132466398ba3",
    "environment": "b63b6725-ba29-4b2f-86a7-ff43aec718d2",
    "service": "688240da-0da1-472b-8958-43db5ffa6cc7",
    "deployment": "e4d06f60-b771-4f3d-945f-b6825ccd3d7b",
    "replica": "9f7896f2-f060-4031-a77c-267a405baba3"
  },
  "timestamp": "2026-01-13T01:57:38.842134374Z"
}require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)).catch(() => global.fetch(...args));

async function listVault() {
    const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
    const VAULT_TOKEN = process.env.VAULT_TOKEN;
    const MOUNT_POINT = 'secret';

    console.log("--------------------------------------------------");
    console.log("🔍 AUDITORÍA DE CONTENIDO DEL VAULT (Solo Lectura)");
    console.log("--------------------------------------------------");
    console.log(`🔌 URL: ${VAULT_ADDR}`);

    if (!VAULT_TOKEN) {
        console.error("❌ ERROR: VAULT_TOKEN no encontrado en el archivo .env");
        return;
    }

    const headers = {
        'X-Vault-Token': VAULT_TOKEN,
        'Content-Type': 'application/json'
    };

    const paths = ['faucets', 'relayers'];

    for (const path of paths) {
        console.log(`\n📂 Revisando directorio: ${MOUNT_POINT}/${path}/ ...`);
        try {
            // Para KV v2, el listado de llaves se hace en el endpoint /metadata/
            const url = `${VAULT_ADDR}/v1/${MOUNT_POINT}/metadata/${path}?list=true`;
            const res = await fetch(url, { headers });

            if (res.ok) {
                const data = await res.json();
                const keys = data.data.keys;
                console.log(`✅ ¡Se encontraron ${keys.length} llaves!`);
                keys.forEach(key => console.log(`   - ${key}`));
            } else if (res.status === 404) {
                console.warn(`⚠️  El directorio '${path}' está VACÍO o no existe.`);
            } else {
                const errText = await res.text();
                console.error(`❌ Error al listar ${path} (Status ${res.status}): ${errText}`);
            }
        } catch (e) {
            console.error(`💥 Error de conexión al intentar listar ${path}: ${e.message}`);
        }
    }
    console.log("\n--------------------------------------------------");
}

listVault();
