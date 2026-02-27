---
name: SIWE JWT RBAC
description: Authentication and authorization pattern for this project. Uses Sign-In with Ethereum (SIWE) to generate a JWT with role-based access control (RBAC) backed by a PostgreSQL table. Use when implementing auth flows, managing user roles, protecting API routes, or debugging login issues with hardware wallets (Ledger).
---

# SIWE + JWT + RBAC Pattern

## Overview

Authentication is split in two layers:

1. **SIWE** — the user signs a message with MetaMask/Ledger to prove wallet ownership
2. **JWT** — the server issues a token containing `{ address, role }` valid for 12 hours
3. **RBAC** — every protected API route checks `req.user.role` decoded from the JWT

---

## Database Table

```sql
-- Stores one row per wallet address. Address is always stored in lowercase.
CREATE TABLE rbac_users (
    address TEXT PRIMARY KEY,  -- always lowercase (0x...)
    role    TEXT NOT NULL DEFAULT 'REGISTERED'
);
```

### Roles

| Role | Access |
|------|--------|
| `REGISTERED` | Restricted view only — awaiting approval |
| `OPERATOR` | Normal app access (batches, instant payments) |
| `SUPER_ADMIN` | Full access including Contract Admin panel |

### Granting a role (CLI)

```sql
-- Address MUST be lowercase
UPDATE rbac_users
SET role = 'SUPER_ADMIN'
WHERE address = '0x9795e3a0d7824c651adf3880f976ebfdb0121e62';
```

> After updating the DB, the user **must log out and reconnect** — the role is embedded in the JWT at login time.

---

## Backend Flow (`server.js`)

### 1. Nonce endpoint
```
GET /api/auth/nonce → { nonce: "randomString" }
```
Nonce is stored server-side (in-memory or DB) to prevent replay.

### 2. SIWE message format

The frontend builds this exact string (MUST match server-side parser):
```
{domain} wants you to sign in with your Ethereum account:
{checksummedAddress}

I accept the DappsFactory Terms and Conditions.

URI: {origin}
Version: 1
Chain ID: 137
Nonce: {nonce}
Issued At: {issuedAt}
```

### 3. Verify endpoint

```
POST /api/auth/verify
Body: { message, signature }
```

Server:
1. Recovers address from `(message, signature)` using ethers `verifyMessage`
2. Normalizes to `address.toLowerCase().trim()`
3. Queries `rbac_users` for the role (defaults to `REGISTERED` on first login, auto-inserts)
4. Signs JWT: `jwt.sign({ address, role }, JWT_SECRET, { expiresIn: '12h' })`
5. Returns `{ token, address, role }`

```javascript
// Key lines in server.js
const normalizedAddress = fields.address.toLowerCase().trim();
const userRes = await pool.query('SELECT role FROM rbac_users WHERE address = $1', [normalizedAddress]);
let role = 'REGISTERED';
if (userRes.rows.length > 0) role = userRes.rows[0].role;
const token = jwt.sign({ address: normalizedAddress, role }, JWT_SECRET, { expiresIn: '12h' });
```

### 4. Auth middleware

```javascript
// Every protected route uses authenticateToken
function authenticateToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { address, role }
    next();
}

// Usage in routes
if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Forbidden' });
```

---

## Frontend Flow (`app.js`)

### Login

```javascript
// 1. Get nonce
const { nonce } = await fetch('/api/auth/nonce').then(r => r.json());

// 2. Build SIWE message and sign
const checksummedAddress = ethers.getAddress(userAddress); // EIP-55
const message = `${domain} wants you to sign in with your Ethereum account:\n${checksummedAddress}\n\n...`;
const signature = await signer.signMessage(message);

// 3. Verify
const { token, role } = await fetch('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ message, signature })
}).then(r => r.json());

// 4. Store
localStorage.setItem('jwt_token', token);
localStorage.setItem('user_address', address);
```

### RBAC — Nav visibility

The JWT payload is decoded client-side (no secret needed for reading):
```javascript
const payload = JSON.parse(atob(token.split('.')[1]));
const role = payload.role;

// Two places where nav is shown/hidden — BOTH must be updated together:
// 1. On session restore (reading from localStorage)
// 2. After SIWE login (in the auth callback)

if (role === 'SUPER_ADMIN') {
    document.getElementById('navAdmin')?.classList.remove('hidden');
    document.getElementById('navContractAdmin')?.classList.remove('hidden');
    document.getElementById('adminRescueFunds')?.classList.remove('hidden');
} else {
    document.getElementById('navAdmin')?.classList.add('hidden');
    document.getElementById('navContractAdmin')?.classList.add('hidden');
    document.getElementById('adminRescueFunds')?.classList.add('hidden');
}
```

### Token expiry / 401 handling

```javascript
// ⚠️ CRITICAL: DO NOT auto-sign on 401 — breaks Ledger (opens device without consent)
async function renewAuthToken() {
    console.warn('[Auth] Session expired. Please log in again.');
    AUTH_TOKEN = null;
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_address');
    document.getElementById('btnConnect').innerHTML = '🦊 Reconectar';
    return null;
}
```

> **Why no auto-renew?** The `/api/auth/verify` endpoint requires a fresh SIWE nonce — you can't re-use the same nonce. Auto-renewal would require a full SIWE flow, which with a Ledger means physical button press on the device. Attempting this silently on every 401 creates an infinite loop. The correct UX is clearing the session and showing the reconnect button.

---

## Adding a New Protected Page (SUPER_ADMIN only)

1. **HTML**: Add nav item with `class="nav-link hidden"` and a unique `id`
2. **HTML**: Add section `<div id="mySection" class="hidden">` inside `#mainBatchPanel`
3. **JS — RBAC (2 places)**: In `app.js`, add `document.getElementById('myNavId')?.classList.remove/add('hidden')` in BOTH the session-restore block and the post-SIWE block
4. **JS — Nav click**: Register `myNav.addEventListener('click', () => showMySection())`
5. **JS — Show function**: Hide all other sections, show yours, mark nav active

---

## Common Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| Role not showing after DB update | JWT is cached in localStorage | User must log out and reconnect |
| SUPER_ADMIN nav doesn't appear | Only updated one of the two RBAC places | Update BOTH session-restore and post-SIWE blocks |
| Address mismatch in DB query | Address stored uppercase but queried lowercase | Always `address.toLowerCase()` before DB ops |
| Ledger sign loop on 401 | renewAuthToken was calling signMessage | Never auto-sign on 401; clear session instead |
