---
description: Blockchain transaction pattern using RPC balancing and relayer queue for Polygon mainnet
---

# Blockchain RPC Balancing & Relayer Pattern

## Overview
**CRITICAL:** All blockchain transactions (minting, registering, etc.) on Polygon mainnet MUST use the relayer queue system with balanced RPC endpoints. Never make direct blockchain calls.

## Architecture

```
Frontend/Backend Request
        ↓
   Add to Relayer Queue (DB)
        ↓
   Relayer Queue Service
        ↓
   Balanced RPC Pool (5 providers)
        ↓
   Polygon Mainnet
```

## When to Use

✅ **ALWAYS use relayer + RPC balancing for:**
- Certificate minting (`registerDocument`)
- Any smart contract write operations
- Token transfers
- NFT operations
- Blockchain state changes

❌ **NEVER:**
- Make direct ethers.js calls to a single RPC
- Use hardcoded RPC URLs in routes
- Skip the relayer queue for "quick" operations

## Implementation

### 1. Add Transaction to Queue

```javascript
// In backend/routes/*.js
const { relayerQueue } = await import('../services/relayerQueueService.js');

const queueId = await relayerQueue.addToQueue(
    certificateId,           // Unique ID
    'registerDocument',      // Function name
    [                        // Function arguments
        certId,
        ipfsHash,
        tenantSealedKey,
        recipientSealedKey,
        tenantAddress,
        issuerAddress,
        recipientAddress
    ]
);
```

### 2. Relayer Queue Service

**File:** `backend/services/relayerQueueService.js`

Features:
- PostgreSQL SKIP LOCKED queueing
- Automatic retry with exponential backoff
- Gas price bumping (20% per retry)
- Transaction monitoring
- Failed transaction recovery

### 3. Balanced RPC Pool

**File:** `backend/services/blockchainService.js`

```javascript
const RPC_POOL = [
    'https://polygon-mainnet.core.chainstack.com/5b5b1be35c2716962275c3e562d7bf07',
    'https://polygon-mainnet.core.chainstack.com/2cacfbc1a582dd4a12cf3f5c4da7bd18',
    'https://polygon-mainnet.core.chainstack.com/c99ba16538a5dd8727de33ab3a493e1a',
    'https://polygon-mainnet.core.chainstack.com/bbc24912bfc4b87b8b1a2c255863135c',
    'https://polygon-mainnet.core.chainstack.com/4abea835c69d13fcbed0224c2298f4d9'
];

// Round-robin selection with health checks
const provider = getNextHealthyProvider();
```

## Error Handling

The relayer automatically handles:
- RPC failures (switches to next provider)
- Gas estimation errors
- Nonce conflicts
- Transaction replacement
- Network congestion

## Monitoring

Query queue status:
```sql
SELECT status, COUNT(*) 
FROM relayer_queue 
GROUP BY status;
```

## Best Practices

1. **Always queue, never direct call**
   ```javascript
   // ✅ GOOD
   await relayerQueue.addToQueue(id, 'registerDocument', args);
   
   // ❌ BAD
   await contract.registerDocument(...args);
   ```

2. **Update DB status before queueing**
   ```javascript
   await updateCertificateStatus(id, 'processing_on_chain');
   await relayerQueue.addToQueue(id, 'registerDocument', args);
   ```

3. **Let relayer handle retries**
   - Don't retry failed transactions manually
   - Relayer has exponential backoff + gas bumping

4. **Monitor queue in dashboard**
   - `/api/admin/blockchain/stats`
   - Check for stuck transactions

## Common Mistakes

❌ **Don't do this:**
```javascript
// Direct contract call - NO RPC BALANCING
const contract = new ethers.Contract(address, abi, signer);
await contract.registerDocument(...);
```

❌ **Don't do this:**
```javascript
// Single hardcoded RPC
const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
```

✅ **Always do this:**
```javascript
// Use relayer queue
const { relayerQueue } = await import('../services/relayerQueueService.js');
await relayerQueue.addToQueue(id, funcName, args);
```

## Files Reference

- `backend/services/relayerQueueService.js` - Queue management
- `backend/services/blockchainService.js` - RPC pool + providers
- `backend/routes/certificates.js` - Usage example (line ~765)

## Troubleshooting

**Queue stuck?**
```bash
node backend/scripts/monitor-queue.js
```

**Force retry failed transaction:**
```bash
node backend/scripts/force-retry.js <certificate_id>
```

**Check RPC health:**
- Logs show which RPC is used for each transaction
- Switch happens automatically on failure
