# Instant Payment — Estado de Avance

> Última actualización: 2026-03-03

---

## ✅ Sesión 2026-03-03 — Completado Hoy

### Smart Contract V2 (`InstantPaymentV2.sol`)
| Item | Estado |
|---|---|
| Proxy (UUPS) | `0x971da9d642C94f6B5E3867EC891FBA7ef8287d29` |
| Implementación V2 | `0xbfc16912...` |
| `activatePolicyWithPermit(address, uint256, uint256, uint8, bytes32, bytes32)` | ✅ Atómica — permit + policy en 1 TX |
| `version()` returns `"2.0.0"` | ✅ |
| Policy sin `ExceedsPolicyLimit` — allowance ERC-20 ES el presupuesto | ✅ |
| Tag en GitHub | `instant-payment-v2` |

### Backend
| Item | Estado |
|---|---|
| `POST /policy/activate` → usa `activatePolicyWithPermit` (V2) | ✅ |
| Fallback a `activatePolicy` si no hay permit | ✅ |
| `GET /instant/transfers` — SUPER_ADMIN ve todo, non-admin solo lo suyo | ✅ |
| `GET /instant/transfers/export` — idem | ✅ |
| `IP_MAX_RETRIES` env var configurable (default 10) | ✅ |
| `GAS_LIMIT_INSTANT` fallback 250k (era 120k, insuficiente V2) | ✅ |
| `estimateGas()` dinámico con +30% buffer (EIP-1559 skill) | ✅ |
| Auto-marcar `failed` transfers en `pending` con max intentos | ✅ |
| `COMMIT` en vez de `ROLLBACK` cuando no hay pending | ✅ |

### Frontend
| Item | Estado |
|---|---|
| API Key panel solo visible en Instant Payments (no en todas las páginas) | ✅ |
| `permitDeadline = deadlineUnix` (deadline único para permit+policy) | ✅ |
| Siempre firma el permit EIP-2612 (no condicional por allowance) | ✅ |
| Fix: `statusData.registeredRelayer` (era `.relayer` → undefined → doble firma) | ✅ |
| Auto-refresh grilla cada 8s cuando hay PROCESSING/PENDING | ✅ |
| Stop polling al salir de la sección IP | ✅ |

---

## 📋 Pendiente Para Mañana

### API
- [ ] `GET /api/v1/instant/transfers/by-funder/:address` — todas las transfers por cold wallet / funder (para consulta B2B)

### Webhooks
- [ ] Endpoint `POST /api/v1/instant/webhook` para recibir eventos externos
- [ ] Cuando un webhook llega → actualizar la grilla del frontend automáticamente (WebSocket o polling trigger)
- [ ] Casos de uso adicionales: webhook on `transfer.confirmed`, `transfer.failed`, `policy.expired`

### Testing
- [ ] Probar flujo completo de end-to-end: API → relayer → webhook → frontend
- [ ] Probar `transfer.failed` cuando ERC-20 balance insuficiente (nuevo error visible gracias a estimateGas)
- [ ] Probar renovación de permit (cambio de monto y deadline)
- [ ] Edge case: transfer con mismo `transfer_id` duplicado

---

## Smart Contract
| Item | Estado |
|---|---|
| Contrato `InstantPayment.sol` | ✅ Deployado y upgradeado |
| Proxy (UUPS) | `0x971da9d642C94f6B5E3867EC891FBA7ef8287d29` |
| Implementación V2 | `0xbfc16912...` |
| Owner | `0x9795E3A0D7824C651adF3880f976EbfdB0121E62` |
| `maxPolicyAmount` | 20,000 USDC ✅ |
| Red | Polygon Mainnet |

### Funciones del Contrato (V2)
- `registerRelayer(coldWallet, relayer, deadline, signature)` — registra el par coldWallet→relayer via EIP-712
- `activatePolicyWithPermit(coldWallet, amount, deadline, v, r, s)` — **V2 atómica**: permit + policy en 1 TX
- `activatePolicy(coldWallet, totalAmount, deadline)` — legacy (sin permit)
- `executeTransfer(bytes32, from, to, amount)` — el relayer ejecuta transferencias
- `resetPolicy(coldWallet)` — desactiva policy y revoca allowance
- `setMaxPolicyAmount(uint256)` — owner puede cambiar el límite global
- `version()` → `"2.0.0"`

---

## Backend Endpoints

| Endpoint | Auth | Estado |
|---|---|---|
| `GET /api/v1/instant/relayer/status` | JWT | ✅ |
| `GET /api/v1/instant/relayer/nonce` | JWT | ✅ |
| `POST /api/v1/instant/relayer/register` | JWT | ✅ |
| `POST /api/v1/instant/policy/activate` | JWT | ✅ V2 atómica |
| `POST /api/v1/instant/policy/reset` | JWT | ✅ |
| `GET /api/v1/instant/policy` | JWT | ✅ |
| `POST /api/v1/instant/transfer` | API Key / JWT | ✅ |
| `GET /api/v1/instant/transfers` | API Key / JWT | ✅ con paginación |
| `GET /api/v1/instant/transfers/export` | API Key / JWT | ✅ Excel |
| `GET /api/v1/instant/admin/config` | JWT | ✅ |
| `POST /api/v1/instant/admin/config` | JWT SUPER_ADMIN | ✅ |
| `GET /api/v1/instant/apikey` | JWT | ✅ |
| `POST /api/v1/instant/apikey/regenerate` | JWT | ✅ |
