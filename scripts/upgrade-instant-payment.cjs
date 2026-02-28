// scripts/upgrade-instant-payment.cjs
// Upgrades the InstantPayment proxy to the latest implementation,
// luego setea maxPolicyAmount y devuelve el ownership al owner original.
//
// Usage: npx hardhat run scripts/upgrade-instant-payment.cjs --network polygon
//
// Prerequisites:
//   1. DEPLOYER_PRIVATE_KEY in .env must be the CURRENT OWNER of the proxy
//      (run upgrade-step1-fund-and-accept.cjs primero)
//   2. INSTANT_PAYMENT_CONTRACT_ADDRESS must be the proxy address

require('dotenv').config();
const { ethers, upgrades } = require('hardhat');

const ORIGINAL_OWNER = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62'; // MetaMask wallet — devolver ownership acá
const MAX_POLICY_USDC = 20_000;  // 20.000 USDC default

const POST_UPGRADE_ABI = [
    'function setMaxPolicyAmount(uint256 newMax) external',
    'function maxPolicyAmount() view returns (uint256)',
    'function transferOwnership(address newOwner) external',
    'function owner() view returns (address)',
];

async function main() {
    const PROXY = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;
    if (!PROXY) throw new Error('INSTANT_PAYMENT_CONTRACT_ADDRESS not set in .env');

    const [deployer] = await ethers.getSigners();
    console.log('Deployer / current owner:', deployer.address);
    console.log('Proxy address:           ', PROXY);
    console.log('');

    // ── 1. Registrar el proxy existente con el plugin OZ ─────────────────────
    console.log('📋 Registrando proxy existente con OZ Upgrades plugin...');
    const IP = await ethers.getContractFactory('InstantPayment');
    try {
        await upgrades.forceImport(PROXY, IP, { kind: 'uups' });
        console.log('✅ Proxy registrado correctamente.');
    } catch (importErr) {
        // Si ya está importado, ignorar el error
        if (!importErr.message.includes('already registered')) throw importErr;
        console.log('ℹ️  El proxy ya estaba registrado.');
    }

    // ── 2. Upgrade ────────────────────────────────────────────────────────────
    console.log('\n📦 Compilando y deployando nueva implementación...');
    const upgraded = await upgrades.upgradeProxy(PROXY, IP, { kind: 'uups' });
    await upgraded.waitForDeployment();

    const newImpl = await upgrades.erc1967.getImplementationAddress(PROXY);
    console.log('✅ Upgrade completo!');
    console.log('   Proxy:          ', PROXY);
    console.log('   New impl:       ', newImpl);
    console.log(`   Polygonscan:     https://polygonscan.com/address/${newImpl}`);
    console.log('');

    // ── 2. Setear maxPolicyAmount ─────────────────────────────────────────────
    const contract = new ethers.Contract(PROXY, POST_UPGRADE_ABI, deployer);
    const maxRaw = ethers.parseUnits(MAX_POLICY_USDC.toString(), 6); // 6 decimales USDC
    console.log(`💰 Seteando maxPolicyAmount a ${MAX_POLICY_USDC} USDC...`);
    const setTx = await contract.setMaxPolicyAmount(maxRaw, { gasLimit: 80000 });
    console.log('   TX:', setTx.hash);
    await setTx.wait(1);

    const currentMax = await contract.maxPolicyAmount();
    console.log(`✅ maxPolicyAmount confirmado: ${Number(currentMax) / 1_000_000} USDC`);
    console.log('');

    // ── 3. Devolver ownership al owner original ───────────────────────────────
    console.log(`🔑 Proponiendo transferir ownership de vuelta a ${ORIGINAL_OWNER}...`);
    const transferTx = await contract.transferOwnership(ORIGINAL_OWNER, { gasLimit: 80000 });
    console.log('   TX:', transferTx.hash);
    await transferTx.wait(1);
    console.log('✅ transferOwnership ejecutado!');
    console.log('');
    console.log('⚠️  PASO FINAL: El owner original debe llamar acceptOwnership() en la UI.');
    console.log(`   Owner original: ${ORIGINAL_OWNER}`);
    console.log('   Usá el botón "Paso 2: acceptOwnership()" en Contract Admin.');
}

main().catch((err) => {
    console.error('❌ Upgrade failed:', err.message);
    process.exit(1);
});
