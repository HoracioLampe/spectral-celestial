const ethers = require('ethers');

class RpcManager {
    constructor(primaryUrl, fallbackUrl) {
        this.primaryUrl = primaryUrl;
        this.fallbackUrl = fallbackUrl;
        this.currentUrl = primaryUrl;
        this.provider = new ethers.JsonRpcProvider(primaryUrl);
        this.isFallback = false;

        console.log(`[RpcManager] Initialized with Primary: ${this.obfuscate(primaryUrl)}`);
        if (fallbackUrl) console.log(`[RpcManager] Fallback configured: ${this.obfuscate(fallbackUrl)}`);
    }

    obfuscate(url) {
        if (!url) return 'N/A';
        return url.substring(0, 20) + '...';
    }

    getProvider() {
        return this.provider;
    }

    /**
     * Executes a function with automatic retry on fallback provider if the first one fails.
     * @param {Function} attemptFn - Async function (provider) => Promise<T>
     */
    async execute(attemptFn) {
        try {
            return await attemptFn(this.provider);
        } catch (err) {
            // Check for Rate Limit or Network Error
            const isNetworkError = err.message.includes("429") ||
                err.message.includes("limit") ||
                err.message.includes("network") ||
                err.message.includes("timeout") ||
                err.message.includes("connection reset") ||
                err.code === 'NETWORK_ERROR';

            if (isNetworkError && this.fallbackUrl && !this.isFallback) {
                console.warn(`[RpcManager] ⚠️ Primary RPC failed (${err.message}). Switching to Fallback...`);
                this.switchToFallback();

                // Retry with new provider
                try {
                    return await attemptFn(this.provider);
                } catch (retryErr) {
                    console.error(`[RpcManager] ❌ Fallback also failed: ${retryErr.message}`);
                    throw retryErr;
                }
            }

            throw err;
        }
    }

    switchToFallback() {
        this.isFallback = true;
        this.currentUrl = this.fallbackUrl;
        this.provider = new ethers.JsonRpcProvider(this.fallbackUrl);
        console.log(`[RpcManager] 🔄 Switched to Fallback RPC: ${this.obfuscate(this.fallbackUrl)}`);
    }

    resetToPrimary() {
        if (this.isFallback) {
            this.isFallback = false;
            this.currentUrl = this.primaryUrl;
            this.provider = new ethers.JsonRpcProvider(this.primaryUrl);
            console.log(`[RpcManager] 🔙 Reset to Primary RPC`);
        }
    }
}

module.exports = RpcManager;
