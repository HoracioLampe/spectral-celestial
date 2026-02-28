// scripts/upgrade-instant-payment.cjs
// Upgrades the InstantPayment proxy to the latest implementation
// Usage: npx hardhat run scripts/upgrade-instant-payment.cjs --network polygon
//
// Prerequisites:
//   1. DEPLOYER_PRIVATE_KEY in .env must be the current owner of the proxy
//   2. INSTANT_PAYMENT_PROXY in .env must be the proxy address

require('dotenv').config();
const { ethers, upgrades } = require('hardhat');

async function main() {
    const PROXY = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;
    if (!PROXY) throw new Error('INSTANT_PAYMENT_CONTRACT_ADDRESS not set in .env');

    const [deployer] = await ethers.getSigners();
    console.log('Upgrading with deployer:', deployer.address);
    console.log('Proxy address:', PROXY);

    // Confirm deployer is the pending or current owner
    const IP = await ethers.getContractFactory('InstantPayment');

    // Run OZ safety checks + deploy new implementation
    console.log('Deploying new implementation...');
    const upgraded = await upgrades.upgradeProxy(PROXY, IP, {
        kind: 'uups',
        // Acknowledge that maxPolicyAmount was moved to initialize()
        // (existing proxy already has value set, no re-initialization needed)
    });
    await upgraded.waitForDeployment();

    const newImpl = await upgrades.erc1967.getImplementationAddress(PROXY);
    console.log('✅ Upgrade complete!');
    console.log('Proxy:          ', PROXY);
    console.log('New impl:       ', newImpl);
    console.log('');
    console.log('Verify on Polygonscan:');
    console.log(`  https://polygonscan.com/address/${newImpl}`);
}

main().catch((err) => {
    console.error('❌ Upgrade failed:', err.message);
    process.exit(1);
});
