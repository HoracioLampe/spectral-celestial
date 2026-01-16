// services/keyCache.js
// In-memory cache for decrypted private keys with TTL

class KeyCache {
    constructor(ttlMinutes = 7) {
        this.cache = new Map(); // address -> { key, timestamp }
        this.ttlMs = ttlMinutes * 60 * 1000;
    }

    set(address, privateKey) {
        this.cache.set(address.toLowerCase(), {
            key: privateKey,
            timestamp: Date.now()
        });
    }

    get(address) {
        const entry = this.cache.get(address.toLowerCase());
        if (!entry) return null;

        // Check if expired
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(address.toLowerCase());
            return null;
        }

        return entry.key;
    }

    clear() {
        this.cache.clear();
    }

    // Clean expired entries periodically
    cleanExpired() {
        const now = Date.now();
        for (const [addr, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttlMs) {
                this.cache.delete(addr);
            }
        }
    }
}

// Singleton instance
const keyCache = new KeyCache(7); // 7 minutes TTL

// Auto-clean every 5 minutes
setInterval(() => keyCache.cleanExpired(), 5 * 60 * 1000);

module.exports = keyCache;
