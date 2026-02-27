/**
 * instantRelayerEngine.js
 * Worker for processing instant USDC transfers.
 * Uses SELECT FOR UPDATE SKIP LOCKED for concurrency safety.
 * Integrates with globalRpcManager (existing 5-provider pool).
 */

'use strict';

const { ethers } = require('ethers');
const crypto = require('crypto');

// ─── ABI (minimal) ───────────────────────────────────────────────────────────

const INSTANT_PAYMENT_ABI = [
    'function executeTransfer(bytes32 transferId, address from, address to, uint256 amount) external',
    'function isTransferExecuted(bytes32 transferId) external view returns (bool)',
    'function activatePolicy(address coldWallet, uint256 totalAmount, uint256 deadline) external',
    'function resetPolicy(address coldWallet) external',
    'function getPolicyBalance(address coldWallet) external view returns (uint256 totalAmount, uint256 consumedAmount, uint256 remaining, uint256 deadline, bool isActive, bool isExpired)',
    'function pause() external',
    'function unpause() external',
    'event TransferExecuted(bytes32 indexed transferId, address indexed from, address indexed to, uint256 amount)',
    'event TransferFailed(bytes32 indexed transferId, string reason)',
];

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;   // How often to check for pending transfers
const MAX_RETRIES = 10;
const MIN_PRIORITY_GWEI = 25n;    // Polygon PoS minimum (absolute requirement)
const MAX_FEE_GWEI_FALLBACK = 500n;
const PRIORITY_GWEI_FALLBACK = 50n;
const GAS_BUMP_PERCENT = 20;     // +20% per retry
const GAS_LIMIT_INSTANT = 120000n; // Estimated for executeTransfer
const WEBHOOK_MAX_RETRIES = 5;
const WEBHOOK_BASE_DELAY_MS = 1000;

class InstantRelayerEngine {
    constructor({ pool, rpcManager, contractAddress, faucetService, encryption }) {
        this.pool = pool;
        this.rpcManager = rpcManager;
        this.contractAddress = contractAddress;
        this.faucetService = faucetService;
        this.encryption = encryption;
        this.running = false;
        this._timer = null;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[InstantRelayer] Engine started.');
        this._schedule();
    }

    stop() {
        this.running = false;
        if (this._timer) clearTimeout(this._timer);
        console.log('[InstantRelayer] Engine stopped.');
    }

    _schedule() {
        if (!this.running) return;
        this._timer = setTimeout(async () => {
            try { await this._processPending(); } catch (e) {
                console.error('[InstantRelayer] Poll error:', e.message);
            }
            this._schedule();
        }, POLL_INTERVAL_MS);
    }

    // ─── Core Poll Loop ───────────────────────────────────────────────────────

    async _processPending() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Take one pending transfer with row lock (SKIP LOCKED = no blocking)
            const { rows } = await client.query(`
                SELECT * FROM instant_transfers
                WHERE status = 'pending' AND attempt_count < $1
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            `, [MAX_RETRIES]);

            if (rows.length === 0) {
                await client.query('ROLLBACK');
                return;
            }

            const transfer = rows[0];

            // Mark as processing
            await client.query(
                `UPDATE instant_transfers SET status='processing', attempt_count=attempt_count+1, updated_at=NOW() WHERE id=$1`,
                [transfer.id]
            );
            await client.query('COMMIT');

            await this._executeTransfer(transfer);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            console.error('[InstantRelayer] DB error during poll:', err.message);
        } finally {
            client.release();
        }
    }

    // ─── Transfer Execution ───────────────────────────────────────────────────

    async _executeTransfer(transfer) {
        const { id, transfer_id, funder_address, destination_wallet, amount_usdc, attempt_count } = transfer;
        const transferIdBytes = ethers.id(transfer_id).slice(0, 66); // bytes32 from UUID string

        try {
            // Double-check on-chain idempotency before sending
            const alreadyDone = await this.rpcManager.execute(async (provider) => {
                const contract = new ethers.Contract(this.contractAddress, INSTANT_PAYMENT_ABI, provider);
                return contract.isTransferExecuted(transferIdBytes);
            });

            if (alreadyDone) {
                console.log(`[InstantRelayer] Transfer ${transfer_id} already executed on-chain. Marking confirmed.`);
                await this._updateStatus(id, 'confirmed', null, null);
                await this._sendWebhook(transfer, 'transfer.confirmed', {});
                return;
            }

            // Get faucet wallet for the funder (this is the relayer wallet for gas)
            const provider = this.rpcManager.getProvider();
            const faucetWallet = await this.faucetService.getFaucetWallet(this.pool, provider, funder_address);

            // Build gas params with EIP-1559
            const { maxFeePerGas, maxPriorityFeePerGas } = await this._getGasParams(provider, attempt_count);

            // Get/sync nonce from DB
            const nonce = await this._getNonce(faucetWallet.address, provider);

            // Amount in USDC 6-decimal format
            const amountRaw = ethers.parseUnits(amount_usdc.toString(), 6);

            // Build and send transaction
            const contract = new ethers.Contract(this.contractAddress, INSTANT_PAYMENT_ABI, faucetWallet.connect(provider));

            console.log(`[InstantRelayer] Sending transfer ${transfer_id} | ${amount_usdc} USDC → ${destination_wallet} | Nonce: ${nonce} | Attempt: ${attempt_count}`);

            const tx = await contract.executeTransfer(
                transferIdBytes,
                funder_address,
                destination_wallet,
                amountRaw,
                {
                    gasLimit: GAS_LIMIT_INSTANT,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    nonce,
                    chainId: 137
                }
            );

            // Increment nonce in DB
            await this._incrementNonce(faucetWallet.address, nonce);

            console.log(`[InstantRelayer] TX sent: ${tx.hash}`);

            // Update with pending tx hash
            await this._updateStatus(id, 'processing', tx.hash, null);
            await this._sendWebhook(transfer, 'transfer.pending', { tx_hash: tx.hash });

            // Wait for 1 confirmation
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Receipt timeout')), 120000))
            ]);

            if (receipt && receipt.status === 1) {
                console.log(`[InstantRelayer] ✅ Confirmed: ${tx.hash}`);
                await this._updateStatus(id, 'confirmed', tx.hash, null);
                await this._updatePolicyConsumed(funder_address, amount_usdc);
                await this._sendWebhook(transfer, 'transfer.confirmed', { tx_hash: tx.hash, block: receipt.blockNumber });
            } else {
                throw new Error('Transaction reverted on-chain');
            }

        } catch (err) {
            console.error(`[InstantRelayer] ❌ Transfer ${transfer_id} failed (attempt ${attempt_count}): ${err.message}`);

            const isFinal = attempt_count >= MAX_RETRIES;
            const newStatus = isFinal ? 'failed' : 'pending';

            await this._updateStatus(id, newStatus, null, err.message);

            if (isFinal) {
                await this._sendWebhook(transfer, 'transfer.failed', { error: err.message });
            }
        }
    }

    // ─── Gas Management ───────────────────────────────────────────────────────

    async _getGasParams(provider, attemptCount) {
        try {
            const feeData = await provider.getFeeData();
            let maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits(MAX_FEE_GWEI_FALLBACK.toString(), 'gwei');
            let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits(PRIORITY_GWEI_FALLBACK.toString(), 'gwei');

            // Enforce Polygon minimum priority fee
            const minPriority = ethers.parseUnits(MIN_PRIORITY_GWEI.toString(), 'gwei');
            if (maxPriorityFeePerGas < minPriority) {
                maxPriorityFeePerGas = minPriority;
            }

            // Apply bump for retries (+20% per attempt)
            if (attemptCount > 1) {
                const bumpFactor = BigInt(100 + GAS_BUMP_PERCENT * (attemptCount - 1));
                maxFeePerGas = (maxFeePerGas * bumpFactor) / 100n;
                maxPriorityFeePerGas = (maxPriorityFeePerGas * bumpFactor) / 100n;
                // Cap at 500 Gwei
                const maxCap = ethers.parseUnits(MAX_FEE_GWEI_FALLBACK.toString(), 'gwei');
                if (maxFeePerGas > maxCap) maxFeePerGas = maxCap;
            }

            return { maxFeePerGas, maxPriorityFeePerGas };
        } catch (e) {
            console.warn('[InstantRelayer] Gas oracle failed, using fallback:', e.message);
            return {
                maxFeePerGas: ethers.parseUnits(MAX_FEE_GWEI_FALLBACK.toString(), 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits(PRIORITY_GWEI_FALLBACK.toString(), 'gwei'),
            };
        }
    }

    // ─── Nonce Management ─────────────────────────────────────────────────────

    async _getNonce(walletAddress, provider) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // Upsert and lock row
            await client.query(`
                INSERT INTO instant_relayer_nonces (wallet_address, current_nonce)
                VALUES ($1, 0)
                ON CONFLICT (wallet_address) DO NOTHING
            `, [walletAddress]);

            const { rows } = await client.query(
                'SELECT current_nonce FROM instant_relayer_nonces WHERE wallet_address=$1 FOR UPDATE',
                [walletAddress]
            );

            const dbNonce = rows[0]?.current_nonce ?? 0;

            // Sync with chain to prevent nonce-too-low
            const chainNonce = await provider.getTransactionCount(walletAddress, 'pending');
            const nonce = Math.max(dbNonce, chainNonce);

            await client.query('COMMIT');
            return nonce;
        } catch (e) {
            await client.query('ROLLBACK').catch(() => { });
            throw e;
        } finally {
            client.release();
        }
    }

    async _incrementNonce(walletAddress, usedNonce) {
        await this.pool.query(`
            INSERT INTO instant_relayer_nonces (wallet_address, current_nonce, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (wallet_address) DO UPDATE
            SET current_nonce = GREATEST(instant_relayer_nonces.current_nonce, $2) + 1,
                updated_at = NOW()
        `, [walletAddress, usedNonce]);
    }

    // ─── DB Helpers ───────────────────────────────────────────────────────────

    async _updateStatus(id, status, txHash, errorMessage) {
        await this.pool.query(`
            UPDATE instant_transfers
            SET status=$2, tx_hash=COALESCE($3, tx_hash), error_message=$4,
                confirmed_at=CASE WHEN $2='confirmed' THEN NOW() ELSE confirmed_at END,
                updated_at=NOW()
            WHERE id=$1
        `, [id, status, txHash, errorMessage]);
    }

    async _updatePolicyConsumed(coldWallet, amountUsdc) {
        await this.pool.query(`
            UPDATE instant_policies
            SET consumed_amount = consumed_amount + $2, updated_at = NOW()
            WHERE cold_wallet = $1
        `, [coldWallet.toLowerCase(), parseFloat(amountUsdc)]);
    }

    // ─── Webhook Delivery ─────────────────────────────────────────────────────

    async _sendWebhook(transfer, eventType, data) {
        if (!transfer.webhook_url) return;

        const payload = {
            event: eventType,
            transferId: transfer.transfer_id,
            funder: transfer.funder_address,
            to: transfer.destination_wallet,
            amount: transfer.amount_usdc,
            status: transfer.status,
            timestamp: new Date().toISOString(),
            ...data
        };

        let attempt = 0;
        let delivered = false;
        let lastError = '';

        while (attempt < WEBHOOK_MAX_RETRIES && !delivered) {
            attempt++;
            try {
                const ts = Date.now().toString();
                const body = JSON.stringify(payload);
                const secret = process.env.WEBHOOK_SECRET || 'instant-webhook-secret';
                const sig = crypto
                    .createHmac('sha256', secret)
                    .update(ts + body)
                    .digest('hex');

                const response = await fetch(transfer.webhook_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Webhook-Signature': sig,
                        'X-Webhook-Timestamp': ts,
                    },
                    body,
                    signal: AbortSignal.timeout(10000)
                });

                if (response.ok) {
                    delivered = true;
                    console.log(`[InstantRelayer] Webhook delivered: ${eventType} → ${transfer.webhook_url}`);
                } else {
                    lastError = `HTTP ${response.status}`;
                }
            } catch (e) {
                lastError = e.message;
                console.warn(`[InstantRelayer] Webhook attempt ${attempt} failed: ${lastError}`);
            }

            if (!delivered && attempt < WEBHOOK_MAX_RETRIES) {
                const delay = WEBHOOK_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        // Log result
        await this.pool.query(`
            INSERT INTO instant_webhook_logs
              (transfer_id, event_type, payload, webhook_url, delivered, attempt_count, last_error)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            transfer.transfer_id,
            eventType,
            JSON.stringify(payload),
            transfer.webhook_url,
            delivered,
            attempt,
            delivered ? null : lastError
        ]);
    }
}

module.exports = InstantRelayerEngine;
