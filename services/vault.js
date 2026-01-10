
const { ethers } = require('ethers');

// Config
const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
const VAULT_TOKEN = process.env.VAULT_TOKEN;
const MOUNT_POINT = 'secret'; // Standard KV mount
const VAULT_API_V = 'v1';

class VaultService {
    constructor() {
        this.enabled = !!process.env.VAULT_TOKEN;
        if (!this.enabled) {
            console.warn("⚠️ VaultService: VAULT_TOKEN not found. Secrets will NOT be saved to Vault.");
        }
    }

    async _request(method, path, body = null) {
        if (!this.enabled) return null;

        const url = `${VAULT_ADDR}/${VAULT_API_V}/${path}`;
        const options = {
            method,
            headers: {
                'X-Vault-Token': VAULT_TOKEN,
                'Content-Type': 'application/json'
            }
        };
        if (body) options.body = JSON.stringify(body);

        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                if (res.status === 404) return null; // Not found
                const errText = await res.text();
                throw new Error(`Vault Error ${res.status}: ${errText}`);
            }
            return await res.json();
        } catch (err) {
            console.error(`❌ Vault Request Failed (${path}):`, err.message);
            // RE-THROW connectivity errors so the engine knows it failed
            throw err;
        }
    }

    /**
     * Save a Faucet Private Key to Vault
     * Path: secret/data/faucets/<address>
     */
    async saveFaucetKey(address, privateKey) {
        if (!this.enabled) return false;

        // Standard KV v2 write path: mount/data/path
        const path = `${MOUNT_POINT}/data/faucets/${address.toLowerCase()}`;
        const payload = {
            data: {
                private_key: privateKey,
                created_at: new Date().toISOString()
            }
        };

        const res = await this._request('POST', path, payload);
        if (res && res.data) {
            return true;
        }
        return false;
    }

    /**
     * Retrieve a Faucet Private Key
     */
    async getFaucetKey(address) {
        if (!this.enabled) return null;

        // Standard KV v2 read path: mount/data/path
        const path = `${MOUNT_POINT}/data/faucets/${address.toLowerCase()}`;

        const res = await this._request('GET', path);

        // KV v2 structure: response.data.data.key
        if (res && res.data && res.data.data && res.data.data.private_key) {
            return res.data.data.private_key;
        }
        return null;
    }

    /**
     * Save a Relayer Private Key to Vault
     * Path: secret/data/relayers/<address>
     */
    async saveRelayerKey(address, privateKey) {
        if (!this.enabled) return false;

        const path = `${MOUNT_POINT}/data/relayers/${address.toLowerCase()}`;
        const payload = {
            data: {
                private_key: privateKey,
                created_at: new Date().toISOString()
            }
        };

        const res = await this._request('POST', path, payload);
        if (res && res.data) {
            return true;
        }
        throw new Error(`Vault rejected storage for ${address}`);
    }

    /**
     * Alias for saveRelayerKey to support legacy engine calls
     */
    async storeRelayerKey(address, privateKey) {
        return this.saveRelayerKey(address, privateKey);
    }

    /**
     * Retrieve a Relayer Private Key
     */
    async getRelayerKey(address) {
        if (!this.enabled) return null;

        const path = `${MOUNT_POINT}/data/relayers/${address.toLowerCase()}`;
        const res = await this._request('GET', path);

        if (res && res.data && res.data.data && res.data.data.private_key) {
            return res.data.data.private_key;
        }
        return null;
    }

    /**
     * CENTRALIZED AUTO-UNSEAL (Non-blocking with timeout)
     * Checks health and attempts unseal if needed using VAULT_UNSEAL_KEYS env.
     */
    async ensureUnsealed() {
        if (!this.enabled) return;

        const TIMEOUT_MS = 5000; // 5 second timeout
        const envKeys = process.env.VAULT_UNSEAL_KEYS;
        if (!envKeys) {
            return;
        }
        const keys = envKeys.split(',').map(k => k.trim());

        try {

            // Add timeout to prevent blocking
            const healthRes = await Promise.race([
                fetch(`${VAULT_ADDR}/${VAULT_API_V}/sys/health`),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Vault health check timeout')), TIMEOUT_MS))
            ]);

            const health = await healthRes.json();

            if (health.sealed) {
                console.log("[Vault] 🔒 Vault is sealed! Attempting auto-unseal...");
                for (const key of keys) {
                    const res = await Promise.race([
                        fetch(`${VAULT_ADDR}/${VAULT_API_V}/sys/unseal`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key })
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Unseal timeout')), TIMEOUT_MS))
                    ]);
                    const status = await res.json();
                    if (!status.sealed) {
                        console.log("[Vault] 🎉 Auto-unseal successful!");
                        return;
                    }
                }
            }
        } catch (e) {
            console.warn(`[Vault] ⚠️ Auto-unseal check failed (non-critical): ${e.message}`);
        }
    }
}

module.exports = new VaultService();
