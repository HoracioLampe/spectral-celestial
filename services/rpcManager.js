const { ethers } = require('ethers');

class RpcManager {
    constructor(primaryUrl, fallbackUrl) {
        this.primaryUrl = primaryUrl;
        this.fallbackUrl = fallbackUrl;
        this.currentUrl = primaryUrl;
        this.provider = new ethers.JsonRpcProvider(primaryUrl);
        this.isFallback = false;

        // Rate Limiting State
        this.lastCallTime = 0;
        this.minDelay = 100; // Minimum 100ms between calls
        this.currentDelay = 100;
        this.maxDelay = 2000; // Max 2s delay
        this.rpsErrorCount = 0;
        this.consecutiveSuccesses = 0;

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
     * Adaptive delay based on RPS errors
     */
    async applyRateLimit() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastCallTime;

        if (timeSinceLastCall < this.currentDelay) {
            const waitTime = this.currentDelay - timeSinceLastCall;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastCallTime = Date.now();
    }

    /**
     * Increase delay when RPS errors occur
     */
    increaseDelay() {
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxDelay);
        this.rpsErrorCount++;
        this.consecutiveSuccesses = 0;
        console.warn(`[RpcManager] ⚠️ RPS limit hit. Increasing delay to ${this.currentDelay}ms (errors: ${this.rpsErrorCount})`);
    }

    /**
     * Decrease delay when calls succeed
     */
    decreaseDelay() {
        this.consecutiveSuccesses++;

        // Only decrease after 10 consecutive successes
        if (this.consecutiveSuccesses >= 10) {
            this.currentDelay = Math.max(this.currentDelay * 0.8, this.minDelay);
            this.consecutiveSuccesses = 0;
            console.log(`[RpcManager] ✅ Decreasing delay to ${this.currentDelay}ms`);
        }
    }

    /**
     * Check if error is RPS/rate limit related
     */
    isRateLimitError(err) {
        const errorStr = err.message || JSON.stringify(err);

        // Check for Chainstack RPS error code
        if (err.error?.code === -32005) return true;

        // Check for common rate limit indicators
        return errorStr.includes("RPS limit") ||
            errorStr.includes("rate limit") ||
            errorStr.includes("429") ||
            errorStr.includes("too many requests") ||
            errorStr.includes("exceeded");
    }

    /**
     * Executes a function with automatic retry on fallback provider if the first one fails.
     * @param {Function} attemptFn - Async function (provider) => Promise<T>
     * @param {number} maxRetries - Maximum number of retries (default: 3)
     */
    async execute(attemptFn, maxRetries = 3) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Apply rate limiting before each call
                await this.applyRateLimit();

                const result = await attemptFn(this.provider);

                // Success - decrease delay gradually
                this.decreaseDelay();

                return result;

            } catch (err) {
                lastError = err;

                // Check for RPS/Rate Limit Error
                if (this.isRateLimitError(err)) {
                    this.increaseDelay();

                    // Extract suggested wait time from error if available
                    const tryAgainMatch = err.error?.data?.try_again_in;
                    if (tryAgainMatch) {
                        const waitMs = parseFloat(tryAgainMatch) || this.currentDelay;
                        console.log(`[RpcManager] Waiting ${waitMs.toFixed(0)}ms as suggested by RPC...`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                    }

                    // If we've hit too many RPS errors, try fallback
                    if (this.rpsErrorCount >= 3 && this.fallbackUrl && !this.isFallback) {
                        console.warn(`[RpcManager] 🔄 Too many RPS errors (${this.rpsErrorCount}). Switching to Fallback...`);
                        this.switchToFallback();
                        this.rpsErrorCount = 0; // Reset counter for fallback
                    }

                    // Retry with exponential backoff
                    if (attempt < maxRetries) {
                        const backoffDelay = Math.min(500 * Math.pow(2, attempt), 5000);
                        console.log(`[RpcManager] Retry ${attempt + 1}/${maxRetries} after ${backoffDelay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, backoffDelay));
                        continue;
                    }
                }

                // Check for other network errors
                const isNetworkError = err.message.includes("network") ||
                    err.message.includes("timeout") ||
                    err.message.includes("connection reset") ||
                    err.code === 'NETWORK_ERROR';

                if (isNetworkError && this.fallbackUrl && !this.isFallback) {
                    console.warn(`[RpcManager] ⚠️ Network error (${err.message}). Switching to Fallback...`);
                    this.switchToFallback();

                    // Retry with fallback
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        continue;
                    }
                }

                // If last attempt, throw error
                if (attempt === maxRetries) {
                    throw err;
                }
            }
        }

        throw lastError;
    }

    switchToFallback() {
        this.isFallback = true;
        this.currentUrl = this.fallbackUrl;
        this.provider = new ethers.JsonRpcProvider(this.fallbackUrl);
        this.currentDelay = this.minDelay; // Reset delay for new provider
        this.rpsErrorCount = 0;
        console.log(`[RpcManager] 🔄 Switched to Fallback RPC: ${this.obfuscate(this.fallbackUrl)}`);
    }

    resetToPrimary() {
        if (this.isFallback) {
            this.isFallback = false;
            this.currentUrl = this.primaryUrl;
            this.provider = new ethers.JsonRpcProvider(this.primaryUrl);
            this.currentDelay = this.minDelay;
            this.rpsErrorCount = 0;
            console.log(`[RpcManager] 🔙 Reset to Primary RPC`);
        }
    }
}

module.exports = RpcManager;
