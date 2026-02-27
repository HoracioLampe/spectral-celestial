---
description: Secure relayer key management pattern using encrypted database storage with environment-based decryption
---

# Relayer Key Management Pattern

## Overview
**CRITICAL:** The relayer private key is stored ENCRYPTED in the database, NOT in environment variables. Never look for `RELAYER_PRIVATE_KEY` in `.env` for production operations.

## Architecture

```
Database (relayers table)
  ├── address          (plaintext wallet address)
  ├── public_key       (plaintext)
  ├── encrypted_private_key (AES-256-GCM encrypted)
  ├── nonce            (last used nonce, managed by relayer)
  └── is_active        (boolean)
        ↓
   Decrypted at runtime using
   ENCRYPTION_KEY from environment
        ↓
   Used by relayerQueueService
```

## Database Schema

**Table:** `relayers`

```sql
-- Actual column names (use 'address', NOT 'wallet_address')
CREATE TABLE relayers (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,  -- AES-256 encrypted
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## Key Storage Pattern

### ✅ CORRECT Way to Access Relayer Key

### ✅ CORRECT Way to Access Relayer Key

```javascript
// From relayerQueueService.js or relayerService.js
import { getClient } from '../config/database.js';
import crypto from 'crypto';

async function getRelayerPrivateKey() {
    const client = await getClient();
    
    try {
        // 1. Fetch encrypted key, public key, and wallet address from database
        const result = await client.query(
            'SELECT encrypted_private_key, public_key, wallet_address FROM relayers WHERE is_active = TRUE LIMIT 1'
        );
        
        if (!result.rows[0]) {
            throw new Error('No active relayer found in database');
        }
        
        const { encrypted_private_key, public_key, wallet_address } = result.rows[0];
        
        // 2. Decrypt using environment encryption key (AES-256-GCM)
        const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
        
        // Format: iv:authTag:ciphertext
        const parts = encrypted_private_key.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedBuffer = Buffer.from(parts[2], 'hex');
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedBuffer);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString('utf8');
        
    } finally {
        client.release();
    }
}
```

### ❌ WRONG Way (Don't Do This)

```javascript
// ❌ NEVER do this - key is NOT in environment
const privateKey = process.env.RELAYER_PRIVATE_KEY;  // Won't work!
```

## Environment Variable Required

**Only ONE env var is needed:**

```bash
# .env (Hex encoded 32 bytes)
ENCRYPTION_KEY=5e8f4a7c2d9b6a1e8f4a7c2d9b6a1e8f4a7c2d9b6a1e8f4a7c2d9b6a1e8f4a7c
```

## Setup Script Example

To store a new key:

```javascript
// ...
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(privateKey, 'utf8', 'hex');
encrypted += cipher.final('hex');
const authTag = cipher.getAuthTag().toString('hex');

const storedValue = `${iv.toString('hex')}:${authTag}:${encrypted}`;
// Insert storedValue into database
```

## Troubleshooting

### Error: "No active relayer found in database"
**Solution:** Run the relayer setup migration or manually insert a relayer record.

### Error: "Decryption failed"
**Solution:** Check that `ENCRYPTION_KEY` in environment matches the key used to encrypt.

### Error: "RELAYER_PRIVATE_KEY not found"
**Explanation:** This is expected! The key is in the database, not environment variables.

## Related Files

- `backend/services/relayerQueueService.js` - Main relayer service
- `backend/services/blockchainService.js` - Uses relayer for blockchain ops
- `backend/migrations/XXX_create_relayers_table.sql` - Table schema
- `backend/scripts/setup-relayer.js` - Key setup script

## Important Notes

- ✅ Relayer key is in **database** (encrypted)
- ✅ Decryption key is in **environment** (`ENCRYPTION_KEY`)
- ❌ Do NOT add `RELAYER_PRIVATE_KEY` to `.env`
- ❌ Do NOT store plaintext private keys anywhere

## Nonce Management Rules

**CRITICAL: Always insert transactions with `nonce = NULL`.**

The relayer assigns the nonce at execution time by querying the network, guaranteeing it uses the correct current nonce. Pre-assigning nonces causes stale nonce errors on retry.

```
✅ INSERT → nonce = NULL       (relayer assigns correct nonce at execution)
✅ RETRY  → nonce = original   (reuse same nonce to replace a stuck tx via gas bump)
❌ BACKFILL → nonce = <value>  (NEVER pre-assign — will be stale by execution time)
❌ SCRIPT  → nonce = <value>   (NEVER pre-assign in any manual insertion)
```

### How Nonce Sync Works (Automatic)

The nonce is managed **entirely in memory** by `relayerService.js`. The `relayers.nonce` column in the DB is **informational only** and is NOT used by the service.

Flow:
1. **Server startup** → `getOrUpdateNonce()` calls `provider.getTransactionCount(address, 'pending')` to get the real on-chain nonce
2. **Between txs** → increments `this.currentNonce++` in memory (no RPC call needed)
3. **On "nonce too low" error** → `_resyncNonce()` re-reads from the network automatically

**You never need to manually sync the nonce.** The service is stateless — it always reads from the network on startup or on error.

### Recovery: Stale Nonce Cleanup

If transactions were accidentally inserted with stale nonces, reset them:

```sql
-- Clear stale nonces from pending txs (relayer will assign fresh ones)
UPDATE transaction_queue
SET nonce = NULL
WHERE status = 'pending' AND nonce IS NOT NULL;

-- Reset stuck 'processing' txs back to pending
UPDATE transaction_queue
SET status = 'pending', nonce = NULL, next_attempt_at = NOW()
WHERE status = 'processing';
```
- ✅ Always use `getDecryptedRelayerKey()` pattern

