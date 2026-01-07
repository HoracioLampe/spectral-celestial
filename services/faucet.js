// services/faucet.js
// Simple faucet utility for Polygon Mainnet.
// Modernized to fetch keys from HashiCorp Vault.
// STRICT: Target Funder -> DB -> Vault(by Address) -> Generate

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

        // 1. Get metadata from DB for THIS Funder or if we already have the Faucet Address
        // Search by both: it could be the funder_address OR the address itself.
        // CRITICAL: Prioritize match with 'address' to avoid using a sub-faucet if the input IS a faucet address.
        const result = await client.query(`
            SELECT address, funder_address 
            FROM faucets 
            WHERE LOWER(funder_address) = $1 
               OR LOWER(address) = $1 
            ORDER BY (CASE WHEN LOWER(address) = $1 THEN 0 ELSE 1 END) ASC
            LIMIT 1
        `, [targetFunder]);

        if (result.rows.length > 0) {
            faucetAddress = result.rows[0].address;
            console.log(`[FaucetService] Resolved Faucet: ${faucetAddress} (Input: ${targetFunder})`);

            // 2. Try VAULT using FAUCET ADDRESS (Public Key)
            // Flow: DB Lookup -> FaucetAddress -> Vault(Key: address) -> PrivateKey
            try {
                privateKey = await vault.getFaucetKey(faucetAddress);

                if (privateKey) {
                    console.log(`🔒 [FaucetService] Loaded key from Vault for Faucet ${faucetAddress}`);
                } else {
                    // STRICT MODE: If DB has it, Vault MUST have it. Do not auto-regenerate.
                    console.error(`❌ [FaucetService] FATAL: Faucet Address ${faucetAddress} exists in DB (Funder: ${targetFunder}), but Key NOT found in Vault under ${faucetAddress}.`);
                    throw new Error(`INTEGRITY_ERROR: Faucet key missing in Vault for ${faucetAddress}`);
                }
            } catch (e) {
                // If the error is our own Integrity Error, rethrow it.
                if (e.message.includes('INTEGRITY_ERROR')) throw e;
                console.warn(`⚠️ [FaucetService] Vault lookup failed: ${e.message}`);
                // If Vault is down, we definitely shouldn't generate a new one.
                throw new Error(`VAULT_CONNECTION_ERROR: Could not retrieve key for ${faucetAddress}`);
            }
        }

        // 3. If NO DB Entry found -> GENERATE NEW
        if (!faucetAddress) {
            console.log(`✨ [FaucetService] No Faucet found for ${targetFunder}. Generating NEW...`);

            // A. Generate Random Wallet
            const wallet = ethers.Wallet.createRandom();
            privateKey = wallet.privateKey;
            faucetAddress = wallet.address;

            // B. Save to VAULT (Key: Public Address, Value: Private Key)
            console.log(`🔒 [FaucetService] Saving new key to Vault under Faucet Address: ${faucetAddress}`);
            try {
                const saved = await vault.saveFaucetKey(faucetAddress, privateKey);
                if (!saved) {
                    throw new Error("Vault save returned false (Check Vault Status/Token)");
                }
            } catch (e) {
                console.error(`❌ [FaucetService] CRITICAL: Failed to save to Vault: ${e.message}`);
                throw new Error(`SECURE_STORAGE_FAILED: Could not save Faucet Key to Vault for ${faucetAddress}`);
            }

            // C. Save to DB (Atomic Insert - IMMUTABLE)
            // Once a faucet is assigned to a funder, it NEVER changes
            // ON CONFLICT DO NOTHING ensures we don't overwrite existing assignments
            await client.query(`
                INSERT INTO faucets (address, funder_address) 
                VALUES ($1, $2)
                ON CONFLICT (funder_address) 
                DO NOTHING
            `, [faucetAddress, targetFunder]);
            console.log(`🪙 [FaucetService] Saved Faucet entry for ${targetFunder} (address: ${faucetAddress})`);
        } else {
            // IMMUTABILITY CHECK: Verify DB and Vault match
            const wallet = new ethers.Wallet(privateKey);

            if (faucetAddress && faucetAddress.toLowerCase() !== wallet.address.toLowerCase()) {
                // CRITICAL ERROR: DB and Vault are out of sync
                // This should NEVER happen in production
                console.error(`❌ [FaucetService] CRITICAL MISMATCH! DB: ${faucetAddress} vs Vault Key: ${wallet.address}`);
                throw new Error(`INTEGRITY_ERROR: Faucet address mismatch for ${targetFunder}. Manual intervention required.`);
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
