const { ethers } = require('ethers');

class RpcManager {
    constructor(primaryUrl, fallbackUrl) {
        this.primaryUrl = primaryUrl;
        this.fallbackUrl = fallbackUrl;
        this.currentProvider = new ethers.JsonRpcProvider(primaryUrl);
        this.fallbackProvider = fallbackUrl ? new ethers.JsonRpcProvider(fallbackUrl) : null;
        this.usingFallback = false;
        this.rateLimitCount = 0;
        this.lastRateLimitTime = 0;

        console.log(`[RpcManager] Initialized with Primary: ${primaryUrl.substring(0, 40)}...`);
        if (fallbackUrl) {
            console.log(`[RpcManager] Fallback available: ${fallbackUrl.substring(0, 40)}...`);
        }
    }

    getProvider() {
        return this.usingFallback && this.fallbackProvider ? this.fallbackProvider : this.currentProvider;
    }

    async execute(operation, maxRetries = 3) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const provider = this.getProvider();
                const result = await operation(provider);

                // Success - reset rate limit counter
                if (this.rateLimitCount > 0) {
                    console.log(`[RpcManager] ✅ Request successful, resetting rate limit counter`);
                    this.rateLimitCount = 0;
                }

                return result;

            } catch (error) {
                lastError = error;
                const errorMsg = error.message || error.toString();
                const errorCode = error.error?.code || error.code;

                // Detect rate limit errors
                const isRateLimit =
                    errorCode === -32005 ||
                    errorMsg.includes('rate limit') ||
                    errorMsg.includes('RPS limit') ||
                    errorMsg.includes('429') ||
                    errorMsg.includes('try_again_in');

                if (isRateLimit) {
                    this.rateLimitCount++;
                    this.lastRateLimitTime = Date.now();

                    console.warn(`[RpcManager] ⚠️ Rate limit detected (${this.rateLimitCount}x): ${errorMsg.substring(0, 100)}`);

                    // Extract suggested wait time
                    const tryAgainIn = error.error?.data?.try_again_in;
                    if (tryAgainIn) {
                        const waitMs = parseFloat(tryAgainIn) || 500;
                        console.log(`[RpcManager] Waiting ${waitMs.toFixed(0)}ms as suggested...`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                    }

                    // Switch to fallback if available and not already using it
                    if (this.fallbackProvider && !this.usingFallback && this.rateLimitCount >= 2) {
                        console.log(`[RpcManager] 🔄 Switching to FALLBACK provider (Quicknode)...`);
                        this.usingFallback = true;

                        // Retry immediately with fallback
                        continue;
                    }

                    // If already on fallback or no fallback, implement exponential backoff
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    console.log(`[RpcManager] ⏳ Waiting ${backoffMs}ms before retry ${attempt}/${maxRetries}...`);
                    await new Promise(resolve => setTimeout(resolve, backoffMs));

                    continue;
                }

                // Network errors
                if (errorMsg.includes('network') || errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
                    console.warn(`[RpcManager] ⚠️ Network error on attempt ${attempt}/${maxRetries}: ${errorMsg.substring(0, 100)}`);

                    // Try fallback on network errors
                    if (this.fallbackProvider && !this.usingFallback) {
                        console.log(`[RpcManager] 🔄 Network error - Switching to FALLBACK...`);
                        this.usingFallback = true;
                        continue;
                    }

                    if (attempt < maxRetries) {
                        const backoffMs = 1000 * attempt;
                        console.log(`[RpcManager] ⏳ Retrying in ${backoffMs}ms...`);
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                        continue;
                    }
                }

                // Other errors - don't retry
                console.error(`[RpcManager] ❌ Non-retryable error: ${errorMsg.substring(0, 150)}`);
                throw error;
            }
        }

        // All retries exhausted
        console.error(`[RpcManager] ❌ All ${maxRetries} retries exhausted`);
        throw lastError;
    }

    // Switch back to primary if fallback was temporary
    async resetToPrimary() {
        if (this.usingFallback) {
            const timeSinceRateLimit = Date.now() - this.lastRateLimitTime;

            // Wait at least 60 seconds before switching back
            if (timeSinceRateLimit > 60000) {
                console.log(`[RpcManager] 🔄 Attempting to switch back to PRIMARY provider...`);
                this.usingFallback = false;
                this.rateLimitCount = 0;
            }
        }
    }
}

module.exports = RpcManager;
