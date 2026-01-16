// services/faucet.js
// Simple faucet utility for Polygon Mainnet.
// Uses encrypted database storage for private keys.

const { ethers } = require('ethers');

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
            SELECT address, funder_address, encrypted_key 
            FROM faucets 
            WHERE LOWER(funder_address) = $1 
               OR LOWER(address) = $1 
            ORDER BY (CASE WHEN LOWER(address) = $1 THEN 0 ELSE 1 END) ASC
            LIMIT 1
        `, [targetFunder]);

        if (result.rows.length > 0) {
            faucetAddress = result.rows[0].address;
            const encryptedKey = result.rows[0].encrypted_key;
            console.log(`[FaucetService] Resolved Faucet: ${faucetAddress} (Input: ${targetFunder})`);

            // 2. Decrypt key from DATABASE
            try {
                if (!encryptedKey) {
                    console.error(`❌ [FaucetService] FATAL: Faucet ${faucetAddress} exists but has no encrypted_key`);
                    throw new Error(`INTEGRITY_ERROR: Faucet key missing in database for ${faucetAddress}`);
                }

                const encryption = require('./encryption');
                privateKey = encryption.decrypt(encryptedKey);
                console.log(`🔒 [FaucetService] Decrypted key from database for Faucet ${faucetAddress}`);
            } catch (e) {
                if (e.message.includes('INTEGRITY_ERROR')) throw e;
                console.error(`❌ [FaucetService] Decryption failed: ${e.message}`);
                throw new Error(`DECRYPTION_ERROR: Could not decrypt key for ${faucetAddress}`);
            }
        }

        // 3. If NO DB Entry found -> GENERATE NEW
        if (!faucetAddress) {
            console.log(`✨ [FaucetService] No Faucet found for ${targetFunder} in DB. Generating NEW...`);

            // A. Generate Random Wallet
            const wallet = ethers.Wallet.createRandom();
            privateKey = wallet.privateKey;
            faucetAddress = wallet.address;

            // B. Encrypt and save to DATABASE (more reliable than Vault)
            console.log(`🔒 [FaucetService] Saving encrypted key to database for: ${faucetAddress}`);
            try {
                const encryption = require('./encryption');
                const encryptedKey = encryption.encrypt(privateKey);

                // C. Save to DB with encrypted key
                await client.query(`
                    INSERT INTO faucets (address, funder_address, encrypted_key) 
                    VALUES ($1, $2, $3)
                    ON CONFLICT (funder_address) 
                    DO NOTHING
                `, [faucetAddress, targetFunder, encryptedKey]);

                console.log(`🪙 [FaucetService] Saved Faucet entry for ${targetFunder} (address: ${faucetAddress})`);
            } catch (e) {
                console.error(`❌ [FaucetService] CRITICAL: Failed to save encrypted key: ${e.message}`);
                throw new Error(`SECURE_STORAGE_FAILED: Could not save Faucet Key for ${faucetAddress}`);
            }
        }

        // Return wallet from DB (always primary now)
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
    const provider = faucetWallet.provider;

    // CRITICAL: Verify nonce before starting distribution
    const latestNonce = await provider.getTransactionCount(faucetWallet.address, 'latest');
    const pendingNonce = await provider.getTransactionCount(faucetWallet.address, 'pending');

    if (pendingNonce > latestNonce) {
        console.warn(`⚠️  [FaucetService] Faucet blocked (${pendingNonce - latestNonce} txs). Attempting simple unblock...`);
        const feeData = await provider.getFeeData();
        const unblockTx = await faucetWallet.sendTransaction({
            to: faucetWallet.address,
            value: 0,
            nonce: latestNonce,
            gasPrice: (feeData.gasPrice * 300n) / 100n, // 3x boost
            gasLimit: 30000
        });
        await unblockTx.wait(1);
        console.log(`✅ [FaucetService] Faucet unblocked.`);
    }

    const feeData = await provider.getFeeData();
    const boostedMaxFee = (feeData.maxFeePerGas * 150n) / 100n;
    const boostedPriorityFee = (feeData.maxPriorityFeePerGas * 150n) / 100n;

    console.log(`🪙 [FaucetService] Distributing to ${relayerAddrs.length} relayers...`);

    // Send sequentially to be safe with nonces
    for (const addr of relayerAddrs) {
        try {
            const tx = await faucetWallet.sendTransaction({
                to: addr,
                value: amountWei,
                maxFeePerGas: boostedMaxFee,
                maxPriorityFeePerGas: boostedPriorityFee,
                gasLimit: 30000 // Small buffer
            });
            console.log(`   📤 Sent to ${addr.substring(0, 8)}... (${tx.hash})`);
            await tx.wait(1);
        } catch (e) {
            console.error(`   ❌ Failed to send to ${addr}: ${e.message}`);
        }
    }
    console.log(`✅ [FaucetService] Distribution complete.`);
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
