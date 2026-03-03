// _temp_probe_impl.cjs — prueba qué funciones soporta la implementación actual
require('dotenv').config();
const { ethers } = require('ethers');

const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const IMPL = '0xac82232f29063c96cc2241de8856c61298dabd15';

async function tryCall(contract, name, args = []) {
    try {
        const result = await contract[name](...args);
        return `✅ OK → ${result}`;
    } catch (e) {
        return `❌ ${e.code || e.message.slice(0, 80)}`;
    }
}

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);

    const abi = [
        'function upgradeTo(address) external',
        'function upgradeToAndCall(address, bytes) external',
        'function owner() view returns (address)',
        'function paused() view returns (bool)',
        'function maxPolicyAmount() view returns (uint256)',
        'function usdcToken() view returns (address)',
        'function coldWalletRelayer() view returns (address)',
    ];

    const proxy = new ethers.Contract(PROXY, abi, provider);

    console.log('=== Funciones disponibles en el Proxy (vía implementación actual) ===');
    console.log('Impl:', IMPL);
    console.log('');
    console.log('owner()               ', await tryCall(proxy, 'owner'));
    console.log('paused()              ', await tryCall(proxy, 'paused'));
    console.log('maxPolicyAmount()     ', await tryCall(proxy, 'maxPolicyAmount'));
    console.log('usdcToken()           ', await tryCall(proxy, 'usdcToken'));
    console.log('coldWalletRelayer()   ', await tryCall(proxy, 'coldWalletRelayer'));
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
