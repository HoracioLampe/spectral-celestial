// scripts/upgrade-step1-fund-deployer.cjs
// El deployer ya es el owner. Solo necesitamos enviarle MATIC para gas.
// Usage: node scripts/upgrade-step1-fund-deployer.cjs

require('dotenv').config();
const { ethers } = require('ethers');
const { Pool } = require('pg');
const encryption = require('../services/encryption');

const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL_1;
const DB_URL = process.env.DATABASE_URL;
const FAUCET_ADDRESS = '0x9675B588a14B986bA98f0f28785Fe9d4F83EAc8e';
const MATIC_TO_SEND = ethers.parseEther('0.15');

async function main() {
    if (!DEPLOYER_PK || !RPC_URL || !DB_URL) {
        throw new Error('Faltan env vars: DEPLOYER_PRIVATE_KEY, RPC_URL_1, DATABASE_URL');
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

    const deployerBalance = await provider.getBalance(deployer.address);
    console.log('Deployer:', deployer.address);
    console.log('Balance actual:', ethers.formatEther(deployerBalance), 'MATIC');

    if (deployerBalance >= ethers.parseEther('0.05')) {
        console.log('✅ El deployer ya tiene suficiente MATIC. Listo para el upgrade.');
        return;
    }

    // Obtener private key de la faucet desde la BD
    const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    const keyRes = await pool.query(
        `SELECT encrypted_key FROM faucets WHERE LOWER(address) = LOWER($1) LIMIT 1`,
        [FAUCET_ADDRESS]
    );
    await pool.end();
    if (!keyRes.rows[0]) throw new Error('Faucet no encontrada en DB: ' + FAUCET_ADDRESS);

    const faucetPk = encryption.decrypt(keyRes.rows[0].encrypted_key);
    const faucetWallet = new ethers.Wallet(faucetPk.trim(), provider);

    const faucetBalance = await provider.getBalance(faucetWallet.address);
    console.log('Faucet:', faucetWallet.address);
    console.log('Faucet balance:', ethers.formatEther(faucetBalance), 'MATIC');

    if (faucetBalance < MATIC_TO_SEND) {
        throw new Error(`Faucet no tiene suficiente MATIC. Tiene: ${ethers.formatEther(faucetBalance)}`);
    }

    console.log(`\nEnviando ${ethers.formatEther(MATIC_TO_SEND)} MATIC al deployer...`);
    const tx = await faucetWallet.sendTransaction({
        to: deployer.address,
        value: MATIC_TO_SEND,
        gasLimit: 21000,
    });
    console.log('TX:', tx.hash);
    console.log('Esperando confirmación...');
    await tx.wait(2);
    const newBalance = await provider.getBalance(deployer.address);
    console.log('✅ MATIC enviado! Nuevo balance deployer:', ethers.formatEther(newBalance), 'MATIC');
    console.log('\nAhora ejecuta:');
    console.log('  npx hardhat run scripts/upgrade-instant-payment.cjs --network polygon');
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
