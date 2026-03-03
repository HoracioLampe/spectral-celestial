// scripts/upgrade-step1-fund-and-accept.cjs
// 1. Envía MATIC desde la faucet al deployer para gas
// 2. El deployer llama acceptOwnership()
// 3. Verifica el nuevo owner
//
// Usage: node scripts/upgrade-step1-fund-and-accept.cjs

require('dotenv').config();
const { ethers } = require('ethers');
const { Pool } = require('pg');

const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
const PROXY = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL_1;
const DB_URL = process.env.DATABASE_URL;
const FAUCET_ADDRESS = '0x9675B588a14B986bA98f0f28785Fe9d4F83EAc8e';
const MATIC_TO_SEND = ethers.parseEther('0.1'); // 0.1 MATIC — suficiente para varios deploys

const OWN_ABI = [
    'function acceptOwnership() external',
    'function owner() view returns (address)',
    'function pendingOwner() view returns (address)',
];

async function main() {
    if (!DEPLOYER_PK) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    if (!PROXY) throw new Error('INSTANT_PAYMENT_CONTRACT_ADDRESS not set');
    if (!RPC_URL) throw new Error('RPC_URL_1 not set');
    if (!DB_URL) throw new Error('DATABASE_URL not set');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    console.log('Deployer:', deployer.address);

    // ── 1. Verificar el estado actual ─────────────────────────────────────────
    const contract = new ethers.Contract(PROXY, OWN_ABI, provider);
    const [owner, pendingOwner] = await Promise.all([
        contract.owner(),
        contract.pendingOwner().catch(() => ethers.ZeroAddress),
    ]);
    console.log('Current owner:  ', owner);
    console.log('Pending owner:  ', pendingOwner);

    if (pendingOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`⚠️  El deployer NO es el pending owner. Pending owner actual: ${pendingOwner}`);
    }

    // ── 2. Obtener la private key de la faucet desde la BD ───────────────────
    const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    const keyRes = await pool.query(
        `SELECT encrypted_private_key FROM faucets WHERE LOWER(address) = LOWER($1) LIMIT 1`,
        [FAUCET_ADDRESS]
    );
    if (!keyRes.rows[0]) throw new Error('Faucet not found in DB: ' + FAUCET_ADDRESS);

    // Desencriptar la key (usa el mismo método que el server)
    const crypto = require('crypto');
    const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY not set');

    const encryptedData = keyRes.rows[0].encrypted_private_key;
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const faucetPk = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');

    const faucetWallet = new ethers.Wallet(faucetPk.trim(), provider);
    console.log('\nFaucet wallet:', faucetWallet.address);

    // ── 3. Verificar balance de faucet ────────────────────────────────────────
    const faucetBalance = await provider.getBalance(faucetWallet.address);
    const deployerBalance = await provider.getBalance(deployer.address);
    console.log('Faucet MATIC balance:', ethers.formatEther(faucetBalance));
    console.log('Deployer MATIC balance:', ethers.formatEther(deployerBalance));

    if (faucetBalance < MATIC_TO_SEND) {
        throw new Error(`Faucet no tiene suficiente MATIC. Tiene: ${ethers.formatEther(faucetBalance)}`);
    }

    // ── 4. Enviar MATIC al deployer ───────────────────────────────────────────
    if (deployerBalance < ethers.parseEther('0.05')) {
        console.log(`\nEnviando ${ethers.formatEther(MATIC_TO_SEND)} MATIC al deployer...`);
        const tx = await faucetWallet.sendTransaction({
            to: deployer.address,
            value: MATIC_TO_SEND,
            gasLimit: 21000,
        });
        console.log('TX enviada:', tx.hash);
        await tx.wait(2);
        console.log('✅ MATIC enviado');
    } else {
        console.log('\nDeployer ya tiene suficiente MATIC, saltando envío.');
    }

    // ── 5. Deployer llama acceptOwnership() ──────────────────────────────────
    console.log('\nLlamando acceptOwnership()...');
    const contractWithDeployer = new ethers.Contract(PROXY, OWN_ABI, deployer);
    const acceptTx = await contractWithDeployer.acceptOwnership({ gasLimit: 80000 });
    console.log('TX enviada:', acceptTx.hash);
    await acceptTx.wait(2);
    console.log('✅ acceptOwnership ejecutado');

    // ── 6. Verificar nuevo owner ──────────────────────────────────────────────
    const newOwner = await contract.owner();
    console.log('\nNew owner:', newOwner);
    if (newOwner.toLowerCase() === deployer.address.toLowerCase()) {
        console.log('✅ El deployer es ahora el owner del contrato!');
        console.log('\nAHORA ejecuta el upgrade:');
        console.log('  npx hardhat run scripts/upgrade-instant-payment.cjs --network polygon');
    }

    await pool.end();
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
