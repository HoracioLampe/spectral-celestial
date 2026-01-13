// EMERGENCY EXTRACTION ENDPOINT
// Add this to server.js temporarily

app.get('/api/emergency/extract-keys', async (req, res) => {
    try {
        const results = {
            vault_status: 'checking',
            keys_found: [],
            errors: []
        };

        // Target addresses to extract
        const targets = [
            '0xe14b99363D029AD0E0723958a283dE0e9978D888',
            '0x7363d49c0ef0ae66ba7907f42932c340136d714f'
        ];

        // Try to unseal first
        try {
            await vault.ensureUnsealed();
            results.vault_status = 'unsealed';
        } catch (e) {
            results.vault_status = `unseal_failed: ${e.message}`;
        }

        // Try to extract each key
        for (const addr of targets) {
            try {
                const pk = await vault.getFaucetKey(addr);
                if (pk) {
                    results.keys_found.push({
                        address: addr,
                        private_key: pk,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    results.errors.push(`${addr}: Key not found in Vault`);
                }
            } catch (e) {
                results.errors.push(`${addr}: ${e.message}`);
            }
        }

        // Return as JSON for easy copying
        res.json(results);

    } catch (e) {
        res.status(500).json({
            error: e.message,
            stack: e.stack
        });
    }
});
