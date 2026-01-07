// services/faucet.js
// Simple faucet utility for Polygon Mainnet.
// Modernized to fetch keys from HashiCorp Vault.
// STRICT: Target Funder -> DB -> Vault -> Generate

const { ethers } = require('ethers');
const vault = require('./vault');

// Helper to get a "Default" funder if we are running in a script context
const DEFAULT_FUNDER = 'SYSTEM_FAUCET_DEPLOYER';

// Load or generate faucet wallet for a SPECIFIC Funder
// funderAddress: The unique identifier (usually user wallet or system id)
async function getFaucetWallet(pool, provider, funderAddress = null) {
    const client = await pool.connect();
    try {
        let privateKey = null;
        let faucetAddress = null;

        // Resolve Target Funder
        // If not passed, we default to the System Funder (safe backup for scripts)
        const targetFunder = (funderAddress || DEFAULT_FUNDER).toLowerCase();

        console.log(`🔍 [FaucetService] Resolving Faucet for Funder: ${targetFunder}`);

        // 1. Get metadata from DB for THIS Funder
        const result = await client.query('SELECT address, funder_address FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [targetFunder]);

        if (result.rows.length > 0) {
            faucetAddress = result.rows[0].address;
            console.log(`[FaucetService] Found existing faucet in DB: ${faucetAddress}`);

            // 2. Try VAULT
            try {
                privateKey = await vault.getFaucetKey(targetFunder);
                if (privateKey) {
                    console.log(`🔒 [FaucetService] Loaded key from Vault for ${targetFunder}`);
                } else {
                    console.warn(`⚠️ [FaucetService] Key NOT found in Vault for ${targetFunder}.`);
                }
            } catch (e) {
                console.warn(`⚠️ [FaucetService] Vault lookup failed: ${e.message}`);
            }
        }

        // 3. If NO Key found (DB empty or Vault missing key), GENERATE NEW
        if (!privateKey) {
            console.log(`⚠️ [FaucetService] No valid Faucet found for ${targetFunder}. Generating NEW...`);

            // A. Generate Random Wallet
            const wallet = ethers.Wallet.createRandom();
            privateKey = wallet.privateKey;
            faucetAddress = wallet.address;

            // B. Save to VAULT
            console.log(`🔒 [FaucetService] Saving new key to Vault under funder: ${targetFunder}`);
            try {
                const saved = await vault.saveFaucetKey(targetFunder, privateKey);
                if (!saved) {
                    throw new Error("Vault save returned false");
                }
            } catch (e) {
                console.error(`❌ [FaucetService] CRITICAL: Failed to save to Vault: ${e.message}`);
            }

            // C. Save to DB (Explicit Upsert)
            // User requested robust handling: Update if exists, Insert if new.
            const existing = await client.query('SELECT id FROM faucets WHERE LOWER(funder_address) = $1', [targetFunder]);

            if (existing.rows.length > 0) {
                await client.query('UPDATE faucets SET address = $1 WHERE LOWER(funder_address) = $2',
                    [faucetAddress, targetFunder]);
                console.log(`🪙 [FaucetService] Updated existing Faucet entry for ${targetFunder}`);
            } else {
                await client.query('INSERT INTO faucets (address, funder_address) VALUES ($1, $2)',
                    [faucetAddress, targetFunder]);
                console.log(`🪙 [FaucetService] Created new Faucet entry for ${targetFunder}`);
            }
        } else {
            // We have a key. Ensure DB sync.
            const wallet = new ethers.Wallet(privateKey);

            if (faucetAddress && faucetAddress.toLowerCase() !== wallet.address.toLowerCase()) {
                console.warn(`⚠️ [FaucetService] Mismatch! DB: ${faucetAddress} vs Vault Key: ${wallet.address}. Trusting Vault.`);
                // Sync DB to match Vault
                await client.query('UPDATE faucets SET address = $1 WHERE LOWER(funder_address) = $2',
                    [wallet.address, targetFunder]);
            } else if (!faucetAddress) {
                // If we got key from Vault but DB was empty (rare edge case of partial sync)
                await client.query('INSERT INTO faucets (address, funder_address) VALUES ($1, $2)',
                    [wallet.address, targetFunder]);
            }
        }

        return new ethers.Wallet(privateKey, provider);
    } finally {
        client.release();
    }
}

/**
 * Calculate the amount of MATIC (in wei) each relayer should receive.
 */
function calculatePerRelayerAmount(totalGas, gasPrice, relayerCount) {
    const bufferedGas = totalGas * 150n / 100n;
    const totalWei = bufferedGas * gasPrice;
    return totalWei / BigInt(relayerCount);
}

/**
 * Distribute MATIC from the faucet to each relayer address.
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
 */
async function collectFundsBack(relayers, faucetWallet) {
    const txs = [];
    for (const wallet of relayers) {
        const balance = await wallet.provider.getBalance(wallet.address);
        if (balance > 0n) {
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
