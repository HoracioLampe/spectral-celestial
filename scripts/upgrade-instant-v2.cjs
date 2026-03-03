// Deploy ONLY the new implementation — does NOT touch the proxy.
// After running this script, the user calls upgradeTo(newImpl) from MetaMask.
require('dotenv').config();
const { ethers } = require('hardhat');

async function main() {
    const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';

    console.log('=== Deploy InstantPaymentV2 Implementation ===');

    const [deployer] = await ethers.getSigners();
    console.log('Deployer:', deployer.address);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log('Balance:', ethers.formatEther(balance), 'MATIC');

    // Deploy ONLY the implementation contract (no proxy interaction)
    const InstantPaymentV2 = await ethers.getContractFactory('InstantPaymentV2');
    console.log('\nDeploying new implementation...');
    const impl = await InstantPaymentV2.deploy();
    await impl.waitForDeployment();

    const implAddress = await impl.getAddress();
    console.log('\n✅ New implementation deployed!');
    console.log('Implementation address:', implAddress);
    console.log('Proxy address (unchanged):', PROXY);
    console.log('\n⚡ Next step:');
    console.log(`   Owner (${await (new ethers.Contract(PROXY, ['function owner() view returns (address)'], ethers.provider)).owner()}) must call:`);
    console.log(`   proxy.upgradeToAndCall("${implAddress}", "0x")`);
    console.log(`   from MetaMask → use the "Upgrade Contract" button in the admin panel.`);

    // Save for easy copy-paste
    console.log('\n--- COPY THIS ---');
    console.log(implAddress);
    console.log('--- END ---');
}

main().catch((err) => {
    console.error('❌ Deploy failed:', err.message);
    process.exit(1);
});
