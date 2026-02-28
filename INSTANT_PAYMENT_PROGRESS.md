# Instant Payment — Estado de Avance

> Última actualización: 2026-02-28

## Smart Contract

| Item | Estado |
|---|---|
| Contrato `InstantPayment.sol` | ✅ Deployado y upgradeado |
| Proxy (UUPS) | `0x971da9d642C94f6B5E3867EC891FBA7ef8287d29` |
| Implementación v2 | `0xa3aCbfa212A8CEEd0206EE1a17Aa91C58fC52309` |
| Owner | `0x9795E3A0D7824C651adF3880f976EbfdB0121E62` |
| `maxPolicyAmount` | 20,000 USDC ✅ |
| Red | Polygon Mainnet |

### Funciones del Contrato (v2)
- `registerRelayer(coldWallet, relayer, deadline, signature)` — registra el par coldWallet→relayer via EIP-712
- `activatePolicy(coldWallet, totalAmount, deadline, permit)` — activa una policy de gasto con USDC permit
- `executeTransfer(...)` — el relayer ejecuta transferencias en nombre del cold wallet
- `setMaxPolicyAmount(uint256)` — owner puede cambiar el límite global de policy
- `maxPolicyAmount()` — getter del límite actual (20,000 USDC default)
- `coldWalletRelayer(address)` — mapping coldWallet → relayer registrado
- `policies(address)` — struct Policy por cold wallet
- `relayerNonces(address)` — nonce anti-replay por cold wallet

---

## Backend (server.js)

| Endpoint | Estado |
|---|---|
| `GET /api/v1/instant/relayer/status` | ✅ Implementado |
| `GET /api/v1/instant/relayer/nonce` | ✅ Implementado |
| `POST /api/v1/instant/relayer/register` | ✅ Implementado |
| `GET /api/v1/instant/admin/config` | ✅ Robusto ante errores RPC |
| `GET /api/v1/instant/admin/status` | ✅ On-chain via Chainstack |
| `POST /api/v1/instant/admin/config` | ✅ Setea maxPolicyAmount (SUPER_ADMIN) |
| Motor de relayer (instantRelayerEngine.js) | ✅ Existe |

**Todos los endpoints protegidos con `authenticateToken`.**

---

## Frontend (Contract Admin UI)

| Feature | Estado |
|---|---|
| Card "Info On-Chain" (owner, paused, maxPolicy) | ✅ Funcional |
| Addresses completas con botón 📋 copiar | ✅ |
| `transferOwnership()` (Paso 1) | ✅ Funcional via MetaMask |
| `acceptOwnership()` (Paso 2) | ✅ Funcional via MetaMask |
| `setMaxPolicyAmount()` | ✅ Funcional via MetaMask |
| `pause/unpause` | ✅ Funcional via MetaMask |
| Sección "Registrar Relayer" | 🔲 Pendiente integración |

---

## Pendiente / Próximos pasos

- [ ] **Registrar Relayer**: el cold wallet debe firmar EIP-712 y el frontend envía a `POST /api/v1/instant/relayer/register`
- [ ] **Activar Policy**: el relayer activa una policy con permit USDC desde el cold wallet
- [ ] **Execute Transfer**: el motor de relayer ejecuta los pagos
- [ ] **Testing E2E**: flujo completo coldWallet → registerRelayer → activatePolicy → executeTransfer
- [ ] **UI de usuario final**: panel para el end-user (activar policy, ver historial)

---

## Scripts de Utilidad

| Script | Uso |
|---|---|
| `scripts/upgrade-manual.cjs` | Upgrade UUPS del proxy (para próximas versiones) |
| `scripts/upgrade-step1-fund-deployer.cjs` | Fondea el deployer desde faucet BD |
| `scripts/deployInstantPayment.cjs` | Deploy inicial del proxy |
| `scripts/_temp_post_upgrade_check.cjs` | Verifica estado on-chain del proxy |
