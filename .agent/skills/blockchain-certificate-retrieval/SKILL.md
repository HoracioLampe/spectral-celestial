# Secure Blockchain Certificate Retrieval & Extraction

This skill documents the pattern for retrieving high-value documents (certificates) securely by resolving their location and encryption keys from the Blockchain, fetching the encrypted payload from IPFS, and performing all decryption and extraction in-memory.

## Core Philosophy
1.  **Blockchain as Source of Truth**: The `ipfsHash` and `recipientSealedKey` MUST come from the Smart Contract, not a local database.
2.  **IPFS as Secure Storage**: The payload on IPFS is an encrypted `tar.gz` bundle.
3.  **In-Memory Processing**: Decrypted files are never written to disk to prevent leakage.
4.  **Strict Ownership**: Always verify that the logged-in user is the `recipient_user_id` in the DB *before* spending gas/resources on blockchain lookups.
5.  **Extraction Transparency**: When extracting from the bundle, scan for **all** files (including `manifest.json` and `.svg`) to prove the bundle's integrity.

## Architecture Flow

1.  **Client Request**: User requests to view/decrypt certificate `certId`.
2.  **Ownership Check**: Backend queries DB: `SELECT id FROM certificates WHERE id = ? AND recipient_user_id = ?`.
3.  **Key Retrieval**: Backend retrieves User's Encrypted Private Key and sanitizes it (removes `0x` if present).
4.  **Blockchain Lookup**: Backend calls `relayerService.getNotaryRecord(certId)` to get:
    *   `ipfsHash` (CID of the encrypted bundle)
    *   `recipientSealedKey` (The AES key for the bundle, encrypted with User's Public Key)
    *   `revoked` (Status check)
5.  **IPFS Fetch**: Backend fetches the encrypted binary from IPFS with **Aggressive Backoff** (retry on 429).
6.  **Double Decryption**:
    *   **Layer 1**: Decrypt `recipientSealedKey` using User's Private Key -> Get `bundleKey`.
    *   **Layer 2**: Decrypt IPFS Payload using `bundleKey` -> Get `tar.gz` buffer.
7.  **Extraction (Comprehensive)**:
    *   Scan `tar.gz` and load all entries into memory.
    *   Parse `manifest.json`.
    *   Filter attachments but include `certificate.svg` and `manifest.json` for verification transparency.
8.  **Response**: Send content + attachments list + Raw Manifest to client.

## Implementation Guide

### 1. Robust Metadata Extraction (`certificateViewerService.js`)

```javascript
async decryptCertificate(certId, userId) {
    // 1. Verify Ownership
    const ownership = await db.query('SELECT id FROM certificates WHERE id = $1 AND recipient_user_id = $2', [certId, userId]);
    if (ownership.rows.length === 0) throw new Error('Unauthorized');

    // 2. Blockchain Source of Truth
    const record = await relayerService.getNotaryRecord(certId); 
    if (!record || record.revoked) throw new Error('Invalid or revoked record');

    // 3. IPFS & Decrypt
    const encryptedBundle = await fetchFromIPFS(record.ipfsHash);
    const decryptedTarGz = await decryptCertificate(encryptedBundle, record.recipientSealedKey, privateKey);

    // 4. Extraction Scan (Transparent)
    const files = {};
    const extract = tar.extract();
    extract.on('entry', (header, stream, next) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
            files[header.name.replace(/^\.\//, '')] = Buffer.concat(chunks);
            next();
        });
        stream.resume();
    });
    // ... pipe buffer to gunzip to extract ...

    // 5. Build Verification Evidence
    const evidenceFiles = Object.keys(files).map(name => ({
        name,
        size: files[name].length,
        type: name.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'
    }));

    return {
        certificate: { content: files['certificate.svg'].toString('base64') },
        manifest: { raw: JSON.parse(files['manifest.json'].toString()) },
        attachments: evidenceFiles,
        verification: { /* ... blockchain status ... */ }
    };
}
```

### 2. Private Key Sanitization (`encryptionService.js`)

Always ensure the private key passed to `EthCrypto.decryptWithPrivateKey` is a raw hex string without `0x`.

```javascript
const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
```

### 3. IPFS Resilience Pattern (`ipfsService.js`)

Implement exponential backoff specifically for 429 (Rate Limit) errors.

```javascript
if (response.status === 429) {
    const delay = 3000 * Math.pow(2, attempt); // Aggressive wait
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, attempt + 1);
}
```

## Security & Verification Benefits
- **Zero Disk Exposure**: No unencrypted certificate content ever touches the server's filesystem.
- **Proof of Integrity**: Showing the `manifest.json` content allow users to verify that the on-chain data matches their document.
- **Strict Beneficiary Isolation**: Users can never intercept or "accidentally" view other recipients' documents due to the DB + Private Key dual-lock.
