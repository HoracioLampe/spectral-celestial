// scripts/deployInstantPayment.cjs
// Deploys InstantPayment.sol as a UUPS proxy then transfers ownership.
// Usage:
//   DEPLOYER_PRIVATE_KEY=0x... USDC_ADDRESS=0x... npx hardhat run scripts/deployInstantPayment.cjs --network polygon

const hre = require('hardhat');

const FINAL_OWNER = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62';
const USDC_ON_POLYGON = process.env.USDC_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC on Polygon

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const balance = await hre.ethers.provider.getBalance(deployer.address);

    console.log('');
    console.log('=== InstantPayment Deployment ===');
    console.log('Deployer:    ', deployer.address);
    console.log('POL balance: ', hre.ethers.formatEther(balance), 'POL');
    console.log('USDC:        ', USDC_ON_POLYGON);
    console.log('Final owner: ', FINAL_OWNER);
    console.log('');

    if (balance < hre.ethers.parseEther('0.5')) {
        throw new Error('Deployer has less than 0.5 POL — please fund it first');
    }

    // 1. Deploy as UUPS proxy — deployer is initial owner
    console.log('[1/3] Deploying InstantPayment proxy...');
    const InstantPayment = await hre.ethers.getContractFactory('InstantPayment');

    const proxy = await hre.upgrades.deployProxy(
        InstantPayment,
        [USDC_ON_POLYGON, deployer.address],   // initialize(usdcToken, owner)
        { kind: 'uups', initializer: 'initialize' }
    );

    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    const implAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

    console.log('[OK] Proxy deployed:         ', proxyAddress);
    console.log('[OK] Implementation address: ', implAddress);

    // 2. Verify on-chain
    const owner = await proxy.owner();
    console.log('[OK] Current owner:          ', owner);

    // 3. Transfer ownership to final owner
    console.log('[2/3] Transferring ownership to', FINAL_OWNER, '...');
    const tx = await proxy.transferOwnership(FINAL_OWNER);
    await tx.wait(1);
    console.log('[OK] Ownership TX:           ', tx.hash);

    const newOwner = await proxy.owner();
    console.log('[OK] New owner confirmed:    ', newOwner);

    // 4. Summary
    console.log('');
    console.log('=== DEPLOYMENT COMPLETE ===');
    console.log('INSTANT_PAYMENT_CONTRACT_ADDRESS=' + proxyAddress);
    console.log('');
    console.log('Add this to Railway env vars and redeploy.');
    console.log('PolygonScan: https://polygonscan.com/address/' + proxyAddress);
}

main().catch((err) => {
    console.error('[!] Deploy failed:', err);
    process.exit(1);
});
