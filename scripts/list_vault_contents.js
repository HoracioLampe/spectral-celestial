require('dotenv').config();
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
