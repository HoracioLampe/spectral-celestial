// scripts/_temp_diagnose_proxy.cjs
// Diagnostica el tipo de proxy en 0x971da9d642...
require('dotenv').config();
const { ethers } = require('ethers');

const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';

// ERC-1967 slots
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);

    const [implRaw, adminRaw, beaconRaw] = await Promise.all([
        provider.getStorage(PROXY, IMPL_SLOT),
        provider.getStorage(PROXY, ADMIN_SLOT),
        provider.getStorage(PROXY, BEACON_SLOT),
    ]);

    const toAddr = (slot) => slot === '0x' + '0'.repeat(64) ? '(none)' : '0x' + slot.slice(-40);

    console.log('=== Diagnóstico del Proxy ===');
    console.log('Proxy address:      ', PROXY);
    console.log('Implementation:     ', toAddr(implRaw));
    console.log('Admin (TranspProxy):', toAddr(adminRaw));
    console.log('Beacon:             ', toAddr(beaconRaw));
    console.log('');

    const adminAddr = toAddr(adminRaw);
    if (adminAddr !== '(none)' && adminAddr !== '0x' + '0'.repeat(40)) {
        console.log('⚠️  Este es un TRANSPARENT PROXY');
        console.log('   Para upgradearlo se necesita llamar upgrade() en el ProxyAdmin:', adminAddr);
        console.log('   Y el caller debe ser el owner del ProxyAdmin.');
    } else {
        console.log('✅ Este parece ser un UUPS Proxy (sin admin slot)');
        console.log('   El owner puede llamar upgradeTo() directamente.');
    }

    // Intentar leer el owner del contrato
    const abi = ['function owner() view returns (address)'];
    const contract = new ethers.Contract(PROXY, abi, provider);
    const owner = await contract.owner().catch(() => 'ERROR - función no disponible');
    console.log('\nOwner del contrato:', owner);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
