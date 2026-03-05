# Instant Payment — Account & Transactions API

**Base URL:** `https://spectral-celestial-dev.up.railway.app`  
**Versión:** v1 · **Env:** `dev` (Railway)  
**Última actualización:** 2026-03-05

---

## Autenticación

Todos los endpoints B2B usan el header `X-Api-Key`.  
La `cold_wallet` **siempre se deriva del API Key** — nunca se pasa como parámetro.

```http
X-Api-Key: sk_live_<tu_api_key>
```

El servidor hace `SHA-256(api_key)` y lo busca en la tabla `instant_api_keys`. Si no existe o está inactiva → `401 Unauthorized`.

> ⚠️ **Nunca expongas tu API Key en código cliente o repos públicos.**

---

## Errores estándar

| HTTP | Cuándo |
|------|--------|
| `401` | API Key ausente, inválida o inactiva |
| `403` | Rol insuficiente (solo `GET /accounts`) |
| `400` | Parámetro con formato inválido |
| `404` | Recurso no encontrado o no pertenece a la wallet |
| `500` | Error interno del servidor |

Todos los errores devuelven:
```json
{ "error": "descripción del error" }
```

---

## Endpoints

### 1. `GET /api/v1/instant/account`

Estado completo de la cuenta asociada al API Key.  
Incluye balances on-chain, política activa y estado del contrato.

**Auth:** `X-Api-Key`  
**Params:** ninguno

#### Request
```http
GET /api/v1/instant/account
X-Api-Key: sk_live_...
```

#### Response `200 OK`
```json
{
  "cold_wallet": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
  "funder": {
    "balance_usdc": "51.219874"
  },
  "faucet": {
    "address":       "0x3212a0a346dd7d17be5b8ce8d441767ae18fe6a8",
    "balance_usdc":  "0.000000",
    "balance_matic": "77.811274"
  },
  "policy": {
    "total_authorized":    "30.000000",
    "consumed":            "20.742330",
    "available_allowance": "9.257670",
    "expires_at":          "2026-03-06T04:35:00.000Z",
    "is_active":           true,
    "status":              "active"
  },
  "contract": {
    "address":   "0x971da9d642C94f6B5E3867EC891FBA7ef8287d29",
    "is_paused": false,
    "owner":     "0x9795E3A0D7824C651adF3880f976EbfdB0121E62",
    "version":   "2.0.0"
  }
}
```

#### Campos

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `cold_wallet` | `string` | Wallet funder derivada del API Key |
| `funder.balance_usdc` | `string` | Balance USDC de la cold wallet (on-chain) |
| `faucet.address` | `string` | Dirección de la wallet faucet (relayer) |
| `faucet.balance_usdc` | `string` | Balance USDC de la faucet |
| `faucet.balance_matic` | `string` | Balance POL/MATIC de la faucet (gas) |
| `policy.total_authorized` | `string` | Total USDC autorizado en la política |
| `policy.consumed` | `string` | USDC ya consumido (calculado on-chain) |
| `policy.available_allowance` | `string` | Allowance ERC-20 disponible real (on-chain) |
| `policy.expires_at` | `ISO 8601 UTC` | Vencimiento del permit |
| `policy.is_active` | `boolean` | Si la política está activa en DB |
| `policy.status` | `enum` | `active` · `expired` · `exhausted` · `inactive` · `none` |
| `contract.address` | `string` | Dirección del proxy InstantPaymentV2 |
| `contract.is_paused` | `boolean` | Si el contrato está pausado |
| `contract.owner` | `string` | Owner del contrato |
| `contract.version` | `string` | Versión del contrato |

> **Nota:** `available_allowance` es el valor real del allowance ERC-20 on-chain — es el presupuesto disponible real del relayer.

---

### 2. `GET /api/v1/instant/accounts`

Estado de **todas** las cuentas del sistema (una por cada funder en `rbac_users`).  
Los datos del contrato se devuelven **una sola vez** en la raíz — no se repiten por wallet.

**Auth:** JWT `SUPER_ADMIN` (no API Key — endpoint administrativo)  
**Params:** ninguno

#### Request
```http
GET /api/v1/instant/accounts
Authorization: Bearer <jwt_super_admin>
```

#### Response `200 OK`
```json
{
  "total": 12,
  "contract": {
    "address":   "0x971da9d642C94f6B5E3867EC891FBA7ef8287d29",
    "is_paused": false,
    "owner":     "0x9795E3A0D7824C651adF3880f976EbfdB0121E62",
    "version":   "2.0.0"
  },
  "accounts": [
    {
      "cold_wallet": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
      "funder":  { "balance_usdc": "51.219874" },
      "faucet":  { "address": "0x3212...", "balance_usdc": "0.000000", "balance_matic": "77.811274" },
      "policy":  { "total_authorized": "30.000000", "consumed": "20.742330", "available_allowance": "9.257670", "expires_at": "2026-03-06T04:35:00.000Z", "is_active": true, "status": "active" }
    },
    {
      "cold_wallet": "0xABCD...",
      "funder":  { "balance_usdc": "0.000000" },
      "faucet":  null,
      "policy":  { "status": "none" }
    }
  ]
}
```

> `faucet: null` indica que la wallet aún no tiene faucet/relayer asignado.

---

### 3. `GET /api/v1/instant/transactions`

Historial de transfers de la cold_wallet del API Key, con filtros opcionales.

**Auth:** `X-Api-Key`  
**Orden:** `created_at DESC` (más recientes primero)

#### Request
```http
GET /api/v1/instant/transactions?status=confirmed&limit=50
X-Api-Key: sk_live_...
```

#### Query params

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `transfer_id` | `string UUID` | — | Devuelve solo esa transferencia. Si vacío o ausente, se ignora. |
| `status` | `string` | todos | `pending` · `processing` · `confirmed` · `failed` |
| `date_from` | `ISO 8601 UTC` | — | Filtra `created_at >= date_from`. Vacío = sin límite. |
| `date_to` | `ISO 8601 UTC` | — | Filtra `created_at <= date_to`. Vacío = sin límite. |
| `limit` | `integer` | `50` | Cantidad máxima de resultados. `-1` = todos sin límite. |

> **Regla clave:** si un parámetro está ausente o vacío (`?status=`), **no se aplica ese filtro**. Solo se valida el formato cuando el parámetro tiene valor.

#### Response `200 OK` — lista

```json
{
  "cold_wallet":   "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
  "total":         106,
  "limit_applied": 50,
  "transfers": [
    {
      "transfer_id":  "d965e281-b514-487a-9160-a6d59468c714",
      "tx_hash":      "0x4fc01a13886e6bb305c91403b69d1351e6e1838692bd6c589f0dd10263ac2591",
      "from_wallet":  "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
      "to_wallet":    "0x9795e3a0d7824c651adf3880f976ebfdb0121e62",
      "amount":       "1.267200",
      "status":       "confirmed",
      "attempts":     1,
      "webhook_url":  "https://tu-servidor.com/api/webhook",
      "created_at":   "2026-03-05T15:47:12.778Z",
      "confirmed_at": "2026-03-05T15:47:18.639Z"
    }
  ]
}
```

#### Response `200 OK` — con `transfer_id`

```json
{
  "cold_wallet": "0x09c31e3a...",
  "transfer": {
    "transfer_id":  "d965e281-b514-487a-9160-a6d59468c714",
    "tx_hash":      "0x4fc01a...",
    "from_wallet":  "0x09c31e3a...",
    "to_wallet":    "0x9795e3a0...",
    "amount":       "1.267200",
    "status":       "confirmed",
    "attempts":     1,
    "webhook_url":  "https://tu-servidor.com/api/webhook",
    "created_at":   "2026-03-05T15:47:12.778Z",
    "confirmed_at": "2026-03-05T15:47:18.639Z"
  }
}
```

#### Campos de transferencia

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `transfer_id` | `UUID` | Identificador único de la transferencia |
| `tx_hash` | `string \| null` | Hash de la tx en Polygon. `null` si aún no fue minada. |
| `from_wallet` | `string` | Wallet origen (cold wallet del funder) |
| `to_wallet` | `string` | Wallet destino |
| `amount` | `string` | Monto en USDC con 6 decimales |
| `status` | `enum` | `pending` · `processing` · `confirmed` · `failed` |
| `attempts` | `integer` | Cantidad de intentos de ejecución |
| `webhook_url` | `string \| null` | URL donde se notificó el resultado |
| `created_at` | `ISO 8601 UTC` | Timestamp de creación |
| `confirmed_at` | `ISO 8601 UTC \| null` | Timestamp de confirmación on-chain. `null` si no confirmada. |

#### Errores `400`

```json
{ "error": "Invalid status. Must be one of: pending, processing, confirmed, failed" }
{ "error": "Invalid date_from — must be ISO 8601 UTC (e.g. 2026-01-01T00:00:00Z)" }
{ "error": "date_from must be ≤ date_to" }
```

#### Error `404`

```json
{ "error": "Transfer not found or does not belong to this wallet" }
```

---

## Ejemplos de uso

### cURL

```bash
# Estado de la cuenta
curl -H "X-Api-Key: sk_live_..." \
  https://spectral-celestial-dev.up.railway.app/api/v1/instant/account

# Últimas 10 transacciones
curl -H "X-Api-Key: sk_live_..." \
  "https://spectral-celestial-dev.up.railway.app/api/v1/instant/transactions?limit=10"

# Solo confirmadas, desde el 1 de marzo
curl -H "X-Api-Key: sk_live_..." \
  "https://spectral-celestial-dev.up.railway.app/api/v1/instant/transactions?status=confirmed&date_from=2026-03-01T00:00:00Z"

# Todas las transacciones (sin límite)
curl -H "X-Api-Key: sk_live_..." \
  "https://spectral-celestial-dev.up.railway.app/api/v1/instant/transactions?limit=-1"

# Una transacción específica
curl -H "X-Api-Key: sk_live_..." \
  "https://spectral-celestial-dev.up.railway.app/api/v1/instant/transactions?transfer_id=d965e281-b514-487a-9160-a6d59468c714"
```

### Node.js

```javascript
const BASE = 'https://spectral-celestial-dev.up.railway.app';
const headers = { 'X-Api-Key': 'sk_live_...' };

// Estado de cuenta
const account = await fetch(`${BASE}/api/v1/instant/account`, { headers }).then(r => r.json());
console.log(account.policy.status); // 'active'
console.log(account.policy.available_allowance); // '9.257670'

// Historial paginado
const history = await fetch(`${BASE}/api/v1/instant/transactions?limit=50`, { headers }).then(r => r.json());
console.log(`${history.total} transferencias totales`);
history.transfers.forEach(t => {
    console.log(`${t.transfer_id} | ${t.amount} USDC | ${t.status} | tx: ${t.tx_hash}`);
});
```

---

## Notas importantes

1. **Monedas:** todos los montos USDC tienen 6 decimales (`"10.000000"`). Los balances MATIC/POL también se muestran con 6 decimales.
2. **Fechas:** siempre en **ISO 8601 UTC** (`2026-03-05T15:47:12.778Z`). `confirmed_at` es `null` mientras la tx no está confirmada on-chain.
3. **tx_hash:** es `null` para transferencias `pending` o `failed` antes de ser enviadas a la blockchain.
4. **policy.available_allowance:** representa el allowance ERC-20 real on-chain (no el valor en DB). Es el presupuesto disponible real para el relayer.
5. **Sync-on-read:** cada llamada a `/account` y `/accounts` actualiza automáticamente el estado de la política en la base de datos con los valores on-chain actuales.
