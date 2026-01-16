
const { ethers } = require('ethers');
require('dotenv').config();

const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const provider = new ethers.JsonRpcProvider(providerUrl);
const address = '0x1cc87a77516F41f17f2D91C57DAE1D00B263F2B0';

async function check() {
    console.log(`Checking address: ${address}`);
    try {
        const code = await provider.getCode(address);
        if (code === '0x') {
            console.log("👉 Result: EOA (Regular Wallet). It has NO code.");
        } else {
            console.log("👉 Result: SMART CONTRACT. Code length: " + code.length);
        }

        const balance = await provider.getBalance(address);
        console.log(`💰 Balance: ${ethers.formatEther(balance)} POL`);

        const txCount = await provider.getTransactionCount(address);
        console.log(`🔢 Nonce (Tx Count): ${txCount}`);

    } catch (err) {
        console.error("Error:", err);
    }
}

check();
