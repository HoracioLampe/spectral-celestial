// services/faucet.js
// Simple faucet utility for Polygon Mainnet.
// It holds a private key (FAUCET_PRIVATE_KEY env var) and can distribute MATIC
// to relayer wallets with a 50% gas buffer, and later collect the funds back.

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load or generate faucet wallet
function getFaucetWallet(provider) {
    let privateKey = process.env.FAUCET_PRIVATE_KEY;
    if (!privateKey) {
        // Generate a new random wallet and persist the key for later download
        const wallet = ethers.Wallet.createRandom();
        privateKey = wallet.privateKey;
        // Save to a file in the project root (you can expose it via an endpoint)
        const keyPath = path.resolve(__dirname, '..', 'faucet_key.txt');
        fs.writeFileSync(keyPath, privateKey, { encoding: 'utf8' });
        console.log('🪙 Faucet wallet generated. Private key saved to', keyPath);
    }
    return new ethers.Wallet(privateKey, provider);
}

/**
 * Calculate the amount of MATIC (in wei) each relayer should receive.
 * totalGas - total gas units estimated for the whole batch.
 * gasPrice - current gas price (wei per gas).
 * relayerCount - number of relayers.
 * Returns a BigNumber amount per relayer (including 50% buffer).
 */
function calculatePerRelayerAmount(totalGas, gasPrice, relayerCount) {
    // Add 50% buffer
    const bufferedGas = totalGas * 150n / 100n;
    const totalWei = bufferedGas * gasPrice;
    return totalWei / BigInt(relayerCount);
}

/**
 * Distribute MATIC from the faucet to each relayer address.
 * relayerAddrs: array of address strings.
 * amountWei: amount each relayer should receive (BigNumber).
 */
async function distributeGas(faucetWallet, relayerAddrs, amountWei) {
    const txs = [];
    for (const addr of relayerAddrs) {
        const tx = faucetWallet.sendTransaction({ to: addr, value: amountWei });
        txs.push(tx);
    }
    await Promise.all(txs.map(p => p.then(r => r.wait())));
    console.log(`🪙 Distributed ${ethers.formatEther(amountWei)} MATIC to each of ${relayerAddrs.length} relayers`);
}

/**
 * Collect remaining balance from relayers back to the faucet.
 * Assumes each relayer wallet still has the faucet as its signer (they are ephemeral wallets).
 * Here we simply send any remaining balance back.
 */
async function collectFundsBack(relayers, faucetWallet) {
    const txs = [];
    for (const wallet of relayers) {
        const balance = await wallet.provider.getBalance(wallet.address);
        if (balance > 0n) {
            // Keep a tiny dust for gas if needed (though we're sweeping)
            const sweepAmount = balance - ethers.parseEther('0.001');
            if (sweepAmount > 0n) {
                const tx = wallet.sendTransaction({ to: faucetWallet.address, value: sweepAmount });
                txs.push(tx);
            }
        }
    }
    await Promise.all(txs.map(p => p.then(r => r.wait())));
    console.log('🔄 Collected remaining funds back to faucet');
}

module.exports = {
    getFaucetWallet,
    calculatePerRelayerAmount,
    distributeGas,
    collectFundsBack,
};
