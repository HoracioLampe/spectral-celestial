// scripts/upgrade-manual.cjs
// Deploy nueva implementación y llama upgradeTo() directamente (sin plugin OZ).
// Evita las validaciones del plugin que pueden causar CALL_EXCEPTION.
// Usage: npx hardhat run scripts/upgrade-manual.cjs --network polygon

require('dotenv').config();
const { ethers } = require('hardhat');

const ORIGINAL_OWNER = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62';
const MAX_POLICY_USDC = 20_000;

const UPGRADE_ABI = [
    'function upgradeTo(address newImplementation) external',
    'function upgradeToAndCall(address newImplementation, bytes calldata data) external',
    'function owner() view returns (address)',
];

const POST_ABI = [
    'function setMaxPolicyAmount(uint256 newMax) external',
    'function maxPolicyAmount() view returns (uint256)',
    'function transferOwnership(address newOwner) external',
    'function owner() view returns (address)',
];

async function main() {
    const PROXY = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;
    if (!PROXY) throw new Error('INSTANT_PAYMENT_CONTRACT_ADDRESS not set');

    const [deployer] = await ethers.getSigners();
    console.log('Deployer:', deployer.address);
    console.log('Proxy:   ', PROXY);

    // Verificar owner
    const proxyContract = new ethers.Contract(PROXY, UPGRADE_ABI, deployer);
    const currentOwner = await proxyContract.owner().catch(() => 'unknown');
    console.log('Owner actual:', currentOwner);
    if (currentOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error('El deployer NO es el owner actual del proxy!');
    }

    // ── 1. Deployar nueva implementación ─────────────────────────────────────
    console.log('\n📦 Deployando nueva implementación de InstantPayment...');
    const IP = await ethers.getContractFactory('InstantPayment');
    const impl = await IP.deploy();
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();
    console.log('✅ Nueva implementación deployada:', implAddr);

    // ── 2. Llamar upgradeToAndCall() en el proxy (OZ v5 eliminó upgradeTo) ────
    console.log('\n🔄 Llamando upgradeToAndCall() en el proxy...');
    const upgradeTx = await proxyContract.upgradeToAndCall(implAddr, '0x', { gasLimit: 300000 });
    console.log('TX:', upgradeTx.hash);
    await upgradeTx.wait(2);
    console.log('✅ Proxy upgradeado!');

    // ── 3. Setear maxPolicyAmount ─────────────────────────────────────────────
    const postContract = new ethers.Contract(PROXY, POST_ABI, deployer);
    const maxRaw = ethers.parseUnits(MAX_POLICY_USDC.toString(), 6);
    console.log(`\n💰 Seteando maxPolicyAmount a ${MAX_POLICY_USDC} USDC...`);
    const setTx = await postContract.setMaxPolicyAmount(maxRaw, { gasLimit: 80000 });
    console.log('TX:', setTx.hash);
    await setTx.wait(1);
    const current = await postContract.maxPolicyAmount();
    console.log(`✅ maxPolicyAmount: ${Number(current) / 1_000_000} USDC`);

    // ── 4. Devolver ownership ─────────────────────────────────────────────────
    console.log(`\n🔑 Transfiriendo ownership de vuelta a ${ORIGINAL_OWNER}...`);
    const transferTx = await postContract.transferOwnership(ORIGINAL_OWNER, { gasLimit: 80000 });
    console.log('TX:', transferTx.hash);
    await transferTx.wait(1);
    console.log('✅ transferOwnership ejecutado!');
    console.log('\n🎉 UPGRADE COMPLETO!');
    console.log('   Proxy:           ', PROXY);
    console.log('   Nueva impl:      ', implAddr);
    console.log(`   Polygonscan:      https://polygonscan.com/address/${implAddr}`);
    console.log('\n⚠️  PASO FINAL REQUERIDO:');
    console.log(`   El owner original (${ORIGINAL_OWNER}) debe aceptar el ownership`);
    console.log('   usando el botón "Paso 2: acceptOwnership()" en Contract Admin.');
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
