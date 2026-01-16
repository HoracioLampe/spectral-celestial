const { ethers } = require('ethers');
require('dotenv').config();

async function debugAddresses() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://polygon-rpc.com');
    const faucet = '0xc14d945a518DFA59009A5e756276D4522b685fde';
    const target = '0x09c31e3a14404eBe473B369c94acde5Ab0EbE0D0';

    console.log('--- DEBUG ADDRESSES ---');

    // Check Faucet
    const fBal = await provider.getBalance(faucet);
    const fCode = await provider.getCode(faucet);
    console.log(`Faucet (${faucet}):`);
    console.log(`  Balance: ${ethers.formatEther(fBal)} POL`);
    console.log(`  Type: ${fCode === '0x' ? 'EOA' : 'CONTRACT'}`);

    // Check Target
    const tBal = await provider.getBalance(target);
    const tCode = await provider.getCode(target);
    console.log(`Target (${target}):`);
    console.log(`  Balance: ${ethers.formatEther(tBal)} POL`);
    console.log(`  Type: ${tCode === '0x' ? 'EOA' : 'CONTRACT'}`);

    if (tCode !== '0x') {
        console.warn('⚠️ WARNING: Target is a CONTRACT. A standard 21,000 gas transfer WILL REVERT if it does not have a receive() function or if it uses too much gas.');
    }
}

debugAddresses().catch(console.error);
