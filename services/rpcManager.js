const ethers = require('ethers');

class RpcManager {
    constructor(primaryUrl, fallbackUrl) {
        // Support both old API (primaryUrl, fallbackUrl) and new API (array)
        let urls = [];

        if (Array.isArray(primaryUrl)) {
            // New API: array of URLs
            urls = primaryUrl.filter(Boolean);
        } else {
            // Old API: primaryUrl + fallbackUrl
            if (primaryUrl) urls.push(primaryUrl);
            if (fallbackUrl) urls.push(fallbackUrl);
        }

        if (urls.length === 0) {
            throw new Error('[RpcManager] At least one RPC URL is required');
        }

        // Initialize RPC pool with health metrics
        this.rpcs = urls.map((url, index) => ({
            url,
            index,
            provider: new ethers.JsonRpcProvider(url),
            weight: 100,
            successCount: 0,
            errorCount: 0,
            totalLatency: 0,
            callCount: 0,
            isHealthy: true,
            lastErrorTime: 0
        }));

        // CRITICAL: Maintain .provider for backward compatibility
        this.currentRpcIndex = 0;
        this.provider = this.rpcs[0].provider;
        this.currentUrl = this.rpcs[0].url;
        this.isFallback = false;

        // Legacy properties for compatibility
        this.primaryUrl = this.rpcs[0].url;
        this.fallbackUrl = this.rpcs.length > 1 ? this.rpcs[1].url : null;

        // Rate limiting
        this.lastCallTime = 0;
        this.minDelay = 100;
        this.currentDelay = 100;
        this.maxDelay = 2000;
        this.rpsErrorCount = 0;
        this.consecutiveSuccesses = 0;

        console.log(`[RpcManager] ✅ Initialized with ${this.rpcs.length} RPC(s)`);
        this.rpcs.forEach((rpc, i) => {
            console.log(`[RpcManager]   RPC${i + 1}: ${this.obfuscate(rpc.url)}`);
        });
    }

    obfuscate(url) {
        if (!url) return 'N/A';
        return url.substring(0, 30) + '...';
    }

    /**
     * Select next RPC using weighted round robin (if multiple RPCs)
     * Falls back to simple selection if only one RPC
     */
    selectNextRpc() {
        if (this.rpcs.length === 1) {
            return this.rpcs[0];
        }

        const healthy = this.rpcs.filter(r => r.isHealthy);

        if (healthy.length === 0) {
            console.warn('[RpcManager] ⚠️ All RPCs unhealthy, resetting...');
            this.rpcs.forEach(r => r.isHealthy = true);
            return this.rpcs[0];
        }

        if (healthy.length === 1) {
            return healthy[0];
        }

        // Weighted selection
        const totalWeight = healthy.reduce((sum, r) => sum + r.weight, 0);
        let random = Math.random() * totalWeight;

        for (const rpc of healthy) {
            random -= rpc.weight;
            if (random <= 0) {
                return rpc;
            }
        }

        return healthy[0];
    }

    /**
     * Get provider (maintains backward compatibility)
     */
    getProvider() {
        const selected = this.selectNextRpc();

        // Update current provider if changed
        if (this.currentRpcIndex !== selected.index) {
            this.currentRpcIndex = selected.index;
            this.provider = selected.provider;
            this.currentUrl = selected.url;
            this.isFallback = selected.index > 0;
        }

        return this.provider;
    }

    recordSuccess(rpc, latency) {
        rpc.successCount++;
        rpc.callCount++;
        rpc.totalLatency += latency;
        rpc.weight = Math.min(100, rpc.weight + 2);

        if (rpc.callCount % 50 === 0) {
            const avg = Math.round(rpc.totalLatency / rpc.callCount);
            console.log(`[RPC${rpc.index + 1}] ${rpc.successCount}/${rpc.callCount} success, weight: ${rpc.weight}, avg: ${avg}ms`);
        }
    }

    recordError(rpc, error) {
        rpc.errorCount++;
        rpc.callCount++;
        rpc.lastErrorTime = Date.now();
        rpc.weight = Math.max(10, rpc.weight - 20);

        console.warn(`[RPC${rpc.index + 1}] Error: ${error.message.substring(0, 40)}... (weight: ${rpc.weight})`);

        const errorRate = rpc.errorCount / Math.max(rpc.callCount, 1);
        if (rpc.errorCount > 5 && errorRate > 0.5) {
            rpc.isHealthy = false;
            console.warn(`[RPC${rpc.index + 1}] 🚨 Marked UNHEALTHY`);

            setTimeout(() => {
                rpc.isHealthy = true;
                rpc.errorCount = 0;
                rpc.weight = 50;
                console.log(`[RPC${rpc.index + 1}] 🔄 Recovered (weight: 50)`);
            }, 60000);
        }
    }

    async applyRateLimit() {
        const now = Date.now();
        const timeSince = now - this.lastCallTime;

        if (timeSince < this.currentDelay) {
            await new Promise(r => setTimeout(r, this.currentDelay - timeSince));
        }

        this.lastCallTime = Date.now();
    }

    increaseDelay() {
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxDelay);
        this.rpsErrorCount++;
        this.consecutiveSuccesses = 0;
    }

    decreaseDelay() {
        this.consecutiveSuccesses++;
        if (this.consecutiveSuccesses >= 10) {
            this.currentDelay = Math.max(this.currentDelay * 0.8, this.minDelay);
            this.consecutiveSuccesses = 0;
        }
    }

    isRateLimitError(err) {
        const msg = err.message || '';
        return err.error?.code === -32005 ||
            msg.includes('RPS limit') ||
            msg.includes('rate limit') ||
            msg.includes('429') ||
            msg.includes('too many requests');
    }

    handleError(err) {
        if (this.isRateLimitError(err)) {
            this.increaseDelay();
            return true;
        }

        const isNetworkError = err.message.includes('network') ||
            err.message.includes('timeout') ||
            err.code === 'NETWORK_ERROR';

        return isNetworkError;
    }

    async execute(attemptFn, maxRetries = 3) {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const selectedRpc = this.selectNextRpc();

            // Update this.provider for compatibility
            this.provider = selectedRpc.provider;
            this.currentRpcIndex = selectedRpc.index;

            try {
                await this.applyRateLimit();

                const start = Date.now();
                const result = await attemptFn(selectedRpc.provider);
                const latency = Date.now() - start;

                this.recordSuccess(selectedRpc, latency);
                this.decreaseDelay();

                return result;

            } catch (err) {
                lastError = err;

                const isRpcError = this.handleError(err) ||
                    err.message.includes('timeout') ||
                    err.message.includes('ECONNRESET');

                if (isRpcError) {
                    this.recordError(selectedRpc, err);

                    if (attempt < maxRetries) {
                        const backoff = 500 * Math.pow(2, attempt);
                        console.log(`[RpcManager] 🔄 Retry ${attempt + 1}/${maxRetries} in ${backoff}ms...`);
                        await new Promise(r => setTimeout(r, backoff));
                        continue;
                    }
                } else {
                    throw err;
                }
            }
        }

        throw new Error(`All RPCs failed after ${maxRetries} attempts: ${lastError.message}`);
    }

    // Legacy methods for compatibility
    switchToFallback() {
        if (this.rpcs.length > 1) {
            this.currentRpcIndex = 1;
            this.provider = this.rpcs[1].provider;
            this.isFallback = true;
            console.log(`[RpcManager] 🔄 Switched to fallback`);
        }
    }

    resetToPrimary() {
        this.currentRpcIndex = 0;
        this.provider = this.rpcs[0].provider;
        this.isFallback = false;
        console.log(`[RpcManager] 🔙 Reset to primary`);
    }
}

module.exports = RpcManager;
