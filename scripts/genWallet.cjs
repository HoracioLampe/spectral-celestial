// scripts/genWallet.cjs
// Generates a random deployer wallet for contract deployment.
// Run: node scripts/genWallet.cjs

const { ethers } = require('ethers');

const wallet = ethers.Wallet.createRandom();
console.log('');
console.log('====================================================');
console.log('  NEW DEPLOYER WALLET — KEEP THIS SECRET');
console.log('====================================================');
console.log('  Address:     ', wallet.address);
console.log('  Private Key: ', wallet.privateKey);
console.log('  Mnemonic:    ', wallet.mnemonic.phrase);
console.log('====================================================');
console.log('');
console.log('Next steps:');
console.log('  1. Send at least 2 POL to:', wallet.address);
console.log('  2. Set env: DEPLOYER_PRIVATE_KEY=' + wallet.privateKey);
console.log('  3. Run deploy: npx hardhat run scripts/deployInstantPayment.cjs --network polygon');
console.log('');
