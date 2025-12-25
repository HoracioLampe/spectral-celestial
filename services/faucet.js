// services/faucet.js
// Simple faucet utility for Polygon Mainnet.
// It holds a private key (FAUCET_PRIVATE_KEY env var) and can distribute MATIC
// to relayer wallets with a 50% gas buffer, and later collect the funds back.

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Load or generate faucet wallet from DB
async function getFaucetWallet(pool, provider) {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
        let privateKey;

        if (result.rows.length > 0) {
            privateKey = result.rows[0].private_key;
        } else {
            // Check ENV fallback for migration/first time
            privateKey = process.env.FAUCET_PRIVATE_KEY;

            if (!privateKey) {
                const wallet = ethers.Wallet.createRandom();
                privateKey = wallet.privateKey;
                await client.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, privateKey]);
                console.log('🪙 New Faucet wallet generated and saved to DB:', wallet.address);
            } else {
                // If it was in ENV but not DB, save it to DB
                const wallet = new ethers.Wallet(privateKey);
                await client.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, privateKey]);
                console.log('🪙 Faucet from ENV saved to DB:', wallet.address);
            }
        }
        return new ethers.Wallet(privateKey, provider);
    } finally {
        client.release();
    }
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
