// scripts/upload-v2-bytecode.cjs
// Sube el bytecode de InstantPaymentV2 a la tabla contract_upgrades.
// La versión se lee automáticamente del string en el archivo .sol (función version()).
// Ejecutar localmente después de: npx hardhat compile
// Uso: node scripts/upload-v2-bytecode.cjs [CONTRACT_NAME]
//   Ejemplo: node scripts/upload-v2-bytecode.cjs InstantPaymentV2
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const CONTRACT_NAME = process.argv[2] || 'InstantPaymentV2';

// Auto-detect version from Solidity source (reads the version() function return value)
function detectVersion(contractName) {
    try {
        const solPath = path.join(__dirname, `../contracts/${contractName}.sol`);
        const src = fs.readFileSync(solPath, 'utf8');
        const match = src.match(/function\s+version\s*\(\s*\)\s+external\s+pure\s+returns\s*\(.*?\)\s*\{\s*return\s+"([^"]+)"/);
        return match ? match[1] : 'unknown';
    } catch (_) { return 'unknown'; }
}

async function main() {
    const artifactPath = path.join(__dirname, `../artifacts/contracts/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`);
    if (!fs.existsSync(artifactPath)) {
        console.error(`❌ Artifact not found. Run: npx hardhat compile`);
        process.exit(1);
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const bytecode = artifact.bytecode;
    const version = detectVersion(CONTRACT_NAME);

    console.log(`Contract:  ${CONTRACT_NAME}`);
    console.log(`Version:   ${version}  (detectado del .sol)`);
    console.log(`Bytecode:  ${bytecode.length} chars`);

    const rawUrl = (process.env.DATABASE_URL || '').replace(/^['"]|['"]$/g, '').trim();
    const pool = new Pool({ connectionString: rawUrl, ssl: { rejectUnauthorized: false } });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_upgrades (
            id          SERIAL PRIMARY KEY,
            version     TEXT NOT NULL,
            contract    TEXT NOT NULL DEFAULT 'InstantPaymentV2',
            bytecode    TEXT NOT NULL,
            uploaded_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(
        'INSERT INTO contract_upgrades (version, contract, bytecode) VALUES ($1, $2, $3)',
        [version, CONTRACT_NAME, bytecode]
    );

    const hist = await pool.query(
        'SELECT id, version, contract, length(bytecode) AS bytes, uploaded_at FROM contract_upgrades ORDER BY id DESC LIMIT 5'
    );
    console.log('\n📋 Historial de versiones:');
    console.table(hist.rows);
    console.log('✅ Bytecode subido correctamente');
    await pool.end();
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
