// _temp_post_upgrade_check.cjs — verifica el estado del proxy tras el upgrade
require('dotenv').config();
const { ethers } = require('ethers');

const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

async function tryCall(contract, name, ...args) {
    try {
        const r = await contract[name](...args);
        return `✅ ${r}`;
    } catch (e) {
        return `❌ ${e.code}: ${e.message.slice(0, 100)}`;
    }
}

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);

    // Leer implementación via slot ERC-1967
    const implRaw = await provider.getStorage(PROXY, IMPL_SLOT);
    const implAddr = '0x' + implRaw.slice(-40);
    console.log('=== Estado Post-Upgrade ===');
    console.log('Proxy:          ', PROXY);
    console.log('Implementación: ', implAddr);
    console.log('');

    const abi = [
        'function owner() view returns (address)',
        'function pendingOwner() view returns (address)',
        'function paused() view returns (bool)',
        'function maxPolicyAmount() view returns (uint256)',
        'function usdcToken() view returns (address)',
        'function coldWalletRelayer() view returns (address)',
    ];
    const c = new ethers.Contract(PROXY, abi, provider);

    console.log('owner()             ', await tryCall(c, 'owner'));
    console.log('pendingOwner()      ', await tryCall(c, 'pendingOwner'));
    console.log('paused()            ', await tryCall(c, 'paused'));
    console.log('maxPolicyAmount()   ', await tryCall(c, 'maxPolicyAmount'));
    console.log('usdcToken()         ', await tryCall(c, 'usdcToken'));
    console.log('coldWalletRelayer() ', await tryCall(c, 'coldWalletRelayer'));
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
