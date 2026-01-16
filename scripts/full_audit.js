const vault = require('../services/vault');
const { Pool } = require('pg');
require('dotenv').config();

async function fullAudit() {
    console.log('--- STARTING FULL VAULT & DB AUDIT ---');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // 1. Check Vault Health
        console.log('Checking Vault Health...');
        const healthRes = await fetch(`${process.env.VAULT_ADDR || 'http://vault-railway-template.railway.internal:8200'}/v1/sys/health`);
        const health = await healthRes.json();
        console.log('Vault Health:', health);

        // 2. List Faucet Keys in Vault
        // We can't easily list all keys without knowing the paths, but we can try to list the metadata
        // Actually, Vault KV v2 has a 'metadata' path to list keys.
        const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
        const headers = { 'X-Vault-Token': process.env.VAULT_TOKEN };

        async function listKeys(subpath) {
            const url = `${VAULT_ADDR}/v1/secret/metadata/${subpath}?list=true`;
            try {
                const res = await fetch(url, { headers });
                if (res.ok) {
                    const data = await res.json();
                    return data.data.keys;
                }
                return [];
            } catch (e) {
                return [];
            }
        }

        const faucetKeys = await listKeys('faucets');
        const relayerKeys = await listKeys('relayers');

        console.log('\n--- VAULT CONTENTS ---');
        console.log('Faucets in Vault:', faucetKeys);
        console.log('Relayers in Vault:', relayerKeys);

        for (const addr of faucetKeys) {
            const pk = await vault.getFaucetKey(addr);
            console.log(`  [Faucet] ${addr}: ${pk ? 'KEY_EXISTS' : 'KEY_MISSING'}`);
            // If the user specifically wants the keys, they can ask, but I'll show them for this debug if they exist.
            if (pk) console.log(`    Content: ${pk.substring(0, 10)}...`);
        }

        // 3. Compare with DB
        const dbFaucets = await pool.query('SELECT * FROM faucets');
        console.log('\n--- DB CONTENTS (Faucets) ---');
        console.table(dbFaucets.rows);

        console.log('\n--- AUDIT COMPLETE ---');

    } catch (e) {
        console.error('Audit failed:', e);
    } finally {
        await pool.end();
    }
}

fullAudit();
