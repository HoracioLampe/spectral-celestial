# Instant Payment API — Documentación de Integración

> **Para:** 3P Smart  
> **Versión:** 2.6.x  
> **Red:** Polygon Mainnet (Chain ID: 137)  
> **Base URL:** `https://<HOST_PRODUCCION>/api/v1/instant`

---

## Tabla de Contenidos

1. [Descripción General](#1-descripción-general)
2. [Autenticación](#2-autenticación)
3. [Endpoints B2B](#3-endpoints-b2b)
   - [POST /transfer — Crear transferencia](#31-post-transfer--crear-transferencia)
   - [GET /transfers — Consultar transferencias](#32-get-transfers--consultar-transferencias)
   - [GET /transfers/export — Exportar Excel](#33-get-transfersexport--exportar-excel)
4. [Webhook — Notificaciones en tiempo real](#4-webhook--notificaciones-en-tiempo-real)
   - [Configuración](#41-configuración-del-webhook)
   - [Verificación de firma HMAC](#42-verificación-de-firma-hmac)
   - [Eventos y payloads](#43-eventos-y-payloads)
   - [Reintentos y logs](#44-reintentos-y-logs)
5. [Ciclo de vida de una transferencia](#5-ciclo-de-vida-de-una-transferencia)
6. [Códigos de error](#6-códigos-de-error)
7. [Ejemplos de código](#7-ejemplos-de-código)
8. [Checklist de integración](#checklist-de-integración)
9. [Información de producción](#información-de-producción)

---

## 1. Descripción General

El sistema de **Instant Payment** permite a integradores externos (como 3P Smart) enviar transferencias de **USDC** en Polygon Mainnet contra el saldo de una _policy_ pre-autorizada del cliente.

**Flujo simplificado:**

```
3P Smart → POST /transfer (API Key) → Cola → Relayer → Blockchain (Polygon)
                                                    ↓
                                            Webhook → tu servidor
```

**Conceptos clave:**

| Concepto | Descripción |
|---|---|
| **Cold Wallet** | Wallet Ethereum del cliente (funder). Todo está asociado a esta dirección. |
| **Policy** | Presupuesto pre-autorizado en USDC. El cliente la activa desde el panel. Tiene monto total y fecha de expiración. |
| **Relayer** | Wallet interna del sistema que ejecuta las transacciones en nombre del cliente (paga el gas). |
| **Transfer ID** | UUID único generado por 3P Smart. Garantiza idempotencia. |
| **API Key** | Clave de autenticación B2B. 1 key por cold wallet. Se genera desde el panel del cliente. |

---

## 2. Autenticación

Todos los endpoints B2B usan **API Key** via header HTTP.

```http
X-Api-Key: sk_live_<TU_API_KEY>
```

> ⚠️ La API Key está vinculada a un **cold_wallet**. El campo `cold_wallet_address` en los requests **debe coincidir exactamente** con la wallet dueña de la key. Si no coinciden, recibirás `403 Forbidden`.

**Características de la API Key:**
- Formato: `sk_live_` + 64 hex chars (72 caracteres totales)
- 1 key por cold wallet. Rotarla invalida la anterior.
- Se muestra **una única vez** al generarla. No se puede recuperar.
- Se puede revocar desde el panel (respuesta `401` para requests subsiguientes).

---

## 3. Endpoints B2B

### 3.1 `POST /transfer` — Crear transferencia

Encola una transferencia de USDC para ser ejecutada por el relayer.

```
POST /api/v1/instant/transfer
X-Api-Key: sk_live_...
Content-Type: application/json
```

**Request body:**

```json
{
  "transfer_id": "550e8400-e29b-41d4-a716-446655440000",
  "cold_wallet_address": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
  "destination_wallet": "0x9795e3a0d7824c651adf3880f976ebfdb0121e62",
  "amount_usdc": "10.500000",
  "webhook_url": "https://mi-servidor.com/webhook/instant"
}
```

| Campo | Tipo | Req. | Descripción |
|---|---|---|---|
| `transfer_id` | string (UUID v4) | ✅ | ID único generado por 3P Smart. Garantiza idempotencia. |
| `cold_wallet_address` | string (0x…) | ✅ | Wallet del cliente (debe coincidir con el dueño de la API Key). |
| `destination_wallet` | string (0x…) | ✅ | Wallet destino de los USDC. |
| `amount_usdc` | string | ✅ | Monto en USDC (6 decimales). Ej: `"10.500000"`. |
| `webhook_url` | string (URL) | ❌ | URL donde recibirás los eventos de esta transferencia. Si se omite, se usa la URL default registrada para el cliente. |

**Respuesta exitosa `201`:**

```json
{
  "success": true,
  "transfer_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Transfer queued successfully"
}
```

**Respuestas de error:**

| HTTP | `error` | Causa |
|---|---|---|
| `400` | `transfer_id, destination_wallet and amount_usdc are required` | Campos obligatorios faltantes |
| `400` | `Invalid destination_wallet address` | Dirección Ethereum inválida |
| `400` | `amount_usdc must be a positive number` | Monto ≤ 0 o no numérico |
| `400` | `cold_wallet_address is required` | Falta el campo |
| `402` | `No active policy for this funder` | El cliente no activó la policy aún |
| `402` | `Insufficient policy balance. Available: X USDC` | Saldo insuficiente en la policy |
| `402` | `Policy has expired. Please reactivate the permit.` | La policy expiró |
| `403` | `cold_wallet_address does not match the API key owner` | Mismatch cold wallet / API Key |
| `409` | `Transfer already exists` | `transfer_id` duplicado — el body incluye `status` y `tx_hash` actuales |
| `500` | Internal error | Error interno del servidor |

> **Idempotencia:** Si enviás el mismo `transfer_id` dos veces, el segundo request retorna `409` con el estado actual de la transferencia original. **No se crea un duplicado.**

---

### 3.2 `GET /transfers` — Consultar transferencias

Lista las transferencias del cliente autenticado con paginación y filtros.

```
GET /api/v1/instant/transfers?status=confirmed&page=1&limit=20
X-Api-Key: sk_live_...
```

**Query params (todos opcionales):**

| Param | Tipo | Descripción |
|---|---|---|
| `status` | string | Filtrar por estado: `pending`, `processing`, `confirmed`, `failed`, `ALL` |
| `date_from` | string (YYYY-MM-DD) | Desde fecha (incluye el día) |
| `date_to` | string (YYYY-MM-DD) | Hasta fecha (incluye el día) |
| `wallet` | string | Filtrar por dirección de destino (búsqueda parcial) |
| `amount` | number | Filtrar por monto ±10% |
| `page` | integer | Página (default: `1`) |
| `limit` | integer | Items por página (default: `20`) |

**Respuesta `200`:**

```json
{
  "transfers": [
    {
      "id": 123,
      "transfer_id": "550e8400-e29b-41d4-a716-446655440000",
      "funder_address": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
      "destination_wallet": "0x9795e3a0d7824c651adf3880f976ebfdb0121e62",
      "amount_usdc": "10.500000",
      "status": "confirmed",
      "tx_hash": "0xabc...",
      "attempt_count": 1,
      "error_message": null,
      "webhook_url": "https://mi-servidor.com/webhook/instant",
      "created_at": "2026-03-04T04:40:48.875Z",
      "confirmed_at": "2026-03-04T04:41:02.100Z"
    }
  ],
  "pagination": {
    "totalItems": 45,
    "currentPage": 1,
    "totalPages": 3,
    "itemsPerPage": 20
  }
}
```

---

### 3.3 `GET /transfers/export` — Exportar Excel

Descarga un archivo `.xlsx` con las transferencias (mismos filtros que el endpoint anterior).

```
GET /api/v1/instant/transfers/export?status=confirmed&date_from=2026-03-01
X-Api-Key: sk_live_...
```

**Respuesta:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

Columnas del Excel: `Transfer ID`, `Funder`, `Destino`, `Monto USDC`, `Estado`, `TX Hash`, `Intentos`, `Creado`, `Confirmado`, `Error`.

---

## 4. Webhook — Notificaciones en tiempo real

### 4.1 Configuración del Webhook

El webhook se puede configurar de **dos formas**:

#### Opción A — Por transferencia (recomendada para 3P Smart)
Incluir `webhook_url` en el body de **cada** `POST /transfer`. Esta URL tiene prioridad sobre la URL default.

#### Opción B — URL default por cliente
El cliente registra una URL default desde el panel → **Connections Admin → Webhook URL**. Se usa como fallback cuando el `POST /transfer` no incluye `webhook_url`.

---

### 4.2 Verificación de Firma HMAC

Cada webhook incluye dos headers de seguridad:

| Header | Descripción |
|---|---|
| `X-Webhook-Signature` | HMAC-SHA256 hex del payload |
| `X-Webhook-Timestamp` | Unix timestamp en milisegundos (string) |

**Algoritmo de verificación:**

```
firma_esperada = HMAC-SHA256(secret, timestamp_string + body_json_raw)
```

> **Importante:** La firma se calcula sobre la **concatenación directa** del timestamp (string) y el body crudo (string JSON), **sin espacio ni separador entre ellos**.

**Protección anti-replay:** El timestamp debe estar dentro de los **±5 minutos** del momento actual. Requests con timestamps más viejos deben ser rechazados con `400`.

**¿Cómo obtener el secret?**  
El cliente genera el secret desde el panel → **Connections Admin → Webhook Secret → Generar**.  
Se muestra **una sola vez**. Formato: `whsec_` + 64 hex chars.

Para verificar, se usa el valor sin el prefijo `whsec_` (los 64 hex chars crudos).

---

### 4.3 Eventos y Payloads

El sistema envía webhooks en estos momentos del ciclo de vida:

| `event` | Momento | `status` en payload |
|---|---|---|
| `transfer.pending` | TX enviada a la blockchain (en mempool) | `processing` |
| `transfer.confirmed` | TX confirmada (1 bloque en Polygon) | `confirmed` |
| `transfer.failed` | Falló definitivamente (agotó todos los reintentos) | `failed` |

---

**Payload `transfer.pending`:**

```json
{
  "event": "transfer.pending",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "funder": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
  "to": "0x9795e3a0d7824c651adf3880f976ebfdb0121e62",
  "amount": "10.500000",
  "status": "processing",
  "timestamp": "2026-03-04T04:40:55.000Z",
  "tx_hash": "0x835e3e003d321cc0e87c38ee99bed27ce5fda7643956f6dd017da0f4be51ddf5",
  "remaining_allowance": "150.000000",
  "policy_expires_at": "2026-03-10T23:00:00.000Z"
}
```

**Payload `transfer.confirmed`:**

```json
{
  "event": "transfer.confirmed",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "funder": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
  "to": "0x9795e3a0d7824c651adf3880f976ebfdb0121e62",
  "amount": "10.500000",
  "status": "confirmed",
  "timestamp": "2026-03-04T04:41:02.100Z",
  "tx_hash": "0x835e3e003d321cc0e87c38ee99bed27ce5fda7643956f6dd017da0f4be51ddf5",
  "block": 68234512,
  "remaining_allowance": "139.500000",
  "policy_expires_at": "2026-03-10T23:00:00.000Z"
}
```

**Payload `transfer.failed`:**

```json
{
  "event": "transfer.failed",
  "transferId": "550e8400-e29b-41d4-a716-446655440000",
  "funder": "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0",
  "to": "0x9795e3a0d7824c651adf3880f976ebfdb0121e62",
  "amount": "10.500000",
  "status": "failed",
  "timestamp": "2026-03-04T04:45:00.000Z",
  "error": "execution reverted: InsufficientPolicyBalance",
  "remaining_allowance": "150.000000",
  "policy_expires_at": "2026-03-10T23:00:00.000Z"
}
```

**Campos del payload:**

| Campo | Tipo | Descripción |
|---|---|---|
| `event` | string | Tipo de evento |
| `transferId` | string (UUID) | El mismo `transfer_id` que enviaron en el POST |
| `funder` | string (0x…) | Cold wallet del cliente |
| `to` | string (0x…) | Wallet destino |
| `amount` | string | Monto USDC |
| `status` | string | Estado actual en la DB |
| `timestamp` | string (ISO 8601) | Momento del evento (UTC) |
| `tx_hash` | string | Hash de la transacción en Polygon (present en `pending` y `confirmed`) |
| `block` | integer | Número de bloque (solo en `confirmed`) |
| `error` | string | Descripción del error (solo en `failed`) |
| `remaining_allowance` | string | USDC restante en la policy tras esta transferencia |
| `policy_expires_at` | string (ISO 8601) | Fecha de expiración de la policy activa |

---

### 4.4 Reintentos y Logs

**Reintentos del webhook** si tu servidor no responde `2xx`:

| Intento | Delay acumulado |
|---|---|
| 1 | Inmediato |
| 2 | 1 segundo |
| 3 | 2 segundos |
| 4 | 4 segundos |
| 5 (último) | 8 segundos |

**Log de entregas:**  
Podés consultar el historial vía `GET /api/v1/instant/webhook/logs` (misma API Key). Incluye `delivered`, `attempt_count`, `last_error`, `http_status` y el payload completo.

**Requisitos para tu endpoint:**
- Responder `2xx` dentro de los **10 segundos**
- Ser **idempotente** (puede recibir el mismo evento más de una vez si hay reintentos)
- **Verificar la firma** antes de procesar cualquier payload

---

## 5. Ciclo de Vida de una Transferencia

```
POST /transfer (201)
       │
       ▼
  status: pending          ← webhooks NO se envían aún
       │
       ▼  (relayer toma la transferencia ~3s después)
  status: processing       ← webhook: transfer.pending  (tx en mempool)
       │
       ├──[TX confirmada]──────► status: confirmed  ← webhook: transfer.confirmed
       │
       └──[TX revertida / error]
              │
              ├─ attempt < MAX_RETRIES ──► status: pending (retry automático)
              │
              └─ attempt ≥ MAX_RETRIES ──► status: failed  ← webhook: transfer.failed
```

**Tiempos aproximados en Polygon Mainnet:**

| Transición | Tiempo estimado |
|---|---|
| `pending → processing` | ~3–10 segundos (relayer pollea cada 3s) |
| `processing → confirmed` | ~5–30 segundos (tiempo de bloque Polygon) |
| Timeout de confirmación | 120 segundos por intento |

---

## 6. Códigos de Error

| HTTP | Significado |
|---|---|
| `201` | Transferencia creada y encolada exitosamente |
| `200` | OK (endpoints GET) |
| `400` | Datos inválidos o campos faltantes |
| `401` | API Key inválida o revocada |
| `402` | Sin policy activa, saldo insuficiente o policy expirada |
| `403` | `cold_wallet_address` no coincide con el dueño de la API Key |
| `409` | `transfer_id` duplicado (ver estado actual en el body de respuesta) |
| `500` | Error interno del servidor |

---

## 7. Ejemplos de Código

### Node.js — Enviar transferencia

```javascript
import crypto from 'crypto';

const BASE_URL = 'https://<HOST_PRODUCCION>/api/v1/instant';
const API_KEY  = 'sk_live_<TU_API_KEY>';

async function sendTransfer({ transferId, coldWallet, destinationWallet, amountUsdc, webhookUrl }) {
  const body = JSON.stringify({
    transfer_id:         transferId,
    cold_wallet_address: coldWallet,
    destination_wallet:  destinationWallet,
    amount_usdc:         amountUsdc,
    webhook_url:         webhookUrl
  });

  const response = await fetch(`${BASE_URL}/transfer`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key':    API_KEY
    },
    body
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`[${response.status}] ${data.error}`);
  }

  return data; // { success: true, transfer_id, status: 'pending' }
}

// Uso
sendTransfer({
  transferId:        crypto.randomUUID(),
  coldWallet:        '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0',
  destinationWallet: '0x9795e3a0d7824c651adf3880f976ebfdb0121e62',
  amountUsdc:        '10.500000',
  webhookUrl:        'https://mi-servidor.3psmart.com/webhook/instant'
}).then(console.log).catch(console.error);
```

---

### Node.js — Servidor receptor de webhooks (Express)

```javascript
import express from 'express';
import crypto  from 'crypto';

const app = express();

// Secret obtenido del panel (Connections Admin → Webhook Secret)
const WEBHOOK_SECRET      = 'whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // Tu secret del panel
const MAX_TIMESTAMP_DRIFT = 5 * 60 * 1000; // 5 minutos anti-replay

// IMPORTANTE: usar raw body para verificar la firma correctamente
app.post('/webhook/instant', express.raw({ type: 'application/json' }), (req, res) => {
  const sig      = req.headers['x-webhook-signature'];
  const tsHeader = req.headers['x-webhook-timestamp'];
  const body     = req.body.toString('utf8'); // string JSON crudo
  const now      = Date.now();
  const ts       = parseInt(tsHeader);

  // 1. Anti-replay: verificar que el timestamp no sea muy viejo
  if (!tsHeader || isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT) {
    return res.status(400).json({ error: 'Timestamp inválido o expirado' });
  }

  // 2. Verificar firma HMAC-SHA256
  //    El secret se usa SIN el prefijo "whsec_"
  const rawSecret = WEBHOOK_SECRET.startsWith('whsec_')
    ? WEBHOOK_SECRET.slice(6)
    : WEBHOOK_SECRET;

  const expected = crypto
    .createHmac('sha256', rawSecret)
    .update(tsHeader + body)   // concatenación directa: timestamp + body
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  // 3. Procesar el evento
  const payload = JSON.parse(body);

  console.log(`[Webhook] ${payload.event} | Transfer: ${payload.transferId}`);

  switch (payload.event) {
    case 'transfer.pending':
      // TX en mempool — podés guardar el tx_hash para tracking
      console.log(`  → TX Hash: ${payload.tx_hash}`);
      break;

    case 'transfer.confirmed':
      // ✅ Acreditar definitivamente en tu sistema
      console.log(`  → Confirmado en bloque ${payload.block}`);
      console.log(`  → Saldo restante en policy: ${payload.remaining_allowance} USDC`);
      // tu lógica de negocio acá
      break;

    case 'transfer.failed':
      // ❌ Notificar fallo al cliente
      console.error(`  → Error: ${payload.error}`);
      break;
  }

  // SIEMPRE responder 200 para que el sistema no reintente
  res.status(200).json({ received: true });
});

app.listen(4001, () => console.log('Webhook receiver corriendo en :4001'));
```

---

### Python — Enviar transferencia y verificar webhook

```python
import hashlib, hmac, json, time, uuid
import requests
from flask import Flask, request, jsonify

BASE_URL = 'https://<HOST_PRODUCCION>/api/v1/instant'
API_KEY  = 'sk_live_<TU_API_KEY>...'
WHSEC    = 'whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'  # Tu secret del panel

# ── Enviar transferencia ──────────────────────────────────────────────────────

def send_transfer(destination_wallet: str, amount_usdc: str, cold_wallet: str) -> dict:
    payload = {
        'transfer_id':         str(uuid.uuid4()),
        'cold_wallet_address': cold_wallet,
        'destination_wallet':  destination_wallet,
        'amount_usdc':         amount_usdc,
        'webhook_url':         'https://mi-servidor.3psmart.com/webhook/instant'
    }
    r = requests.post(
        f'{BASE_URL}/transfer',
        json=payload,
        headers={'X-Api-Key': API_KEY}
    )
    r.raise_for_status()
    return r.json()


# ── Receptor de webhook (Flask) ───────────────────────────────────────────────

app = Flask(__name__)

@app.route('/webhook/instant', methods=['POST'])
def webhook():
    sig       = request.headers.get('X-Webhook-Signature', '')
    ts_header = request.headers.get('X-Webhook-Timestamp', '')
    raw_body  = request.get_data(as_text=True)  # body crudo como string
    now_ms    = int(time.time() * 1000)

    # 1. Anti-replay
    try:
        ts = int(ts_header)
        if abs(now_ms - ts) > 5 * 60 * 1000:
            return jsonify(error='Timestamp expirado'), 400
    except ValueError:
        return jsonify(error='Timestamp inválido'), 400

    # 2. Verificar firma HMAC (sin prefijo "whsec_")
    raw_secret = WHSEC[len('whsec_'):] if WHSEC.startswith('whsec_') else WHSEC
    expected = hmac.new(
        raw_secret.encode(),
        (ts_header + raw_body).encode(),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(sig, expected):
        return jsonify(error='Firma inválida'), 401

    # 3. Procesar
    payload = json.loads(raw_body)
    event   = payload.get('event')

    if event == 'transfer.confirmed':
        print(f"✅ Confirmado: {payload['transferId']} — {payload['amount']} USDC")
        # lógica de acreditación
    elif event == 'transfer.failed':
        print(f"❌ Falló: {payload['transferId']} — {payload.get('error')}")
    elif event == 'transfer.pending':
        print(f"⏳ Pendiente: {payload['transferId']} — TX: {payload.get('tx_hash')}")

    return jsonify(received=True), 200


if __name__ == '__main__':
    app.run(port=4001)
```

---

## Checklist de Integración

- [ ] Obtener **API Key** del cliente desde el panel (Connections Admin → API Key → Generar)
- [ ] Obtener **Webhook Secret** del cliente (Connections Admin → Webhook Secret → Generar)
- [ ] Implementar receptor HTTPS accesible públicamente (no localhost)
- [ ] Verificar firma HMAC-SHA256 en cada webhook entrante
- [ ] Implementar manejo de idempotencia (`transfer_id` debe ser único; guardar procesados)
- [ ] Responder `200` dentro de 10 segundos en el endpoint de webhook
- [ ] Testear con monto mínimo: `"amount_usdc": "0.001000"`
- [ ] Validar que recibís los 3 eventos: `transfer.pending`, `transfer.confirmed` / `transfer.failed`

---

## Información de Producción

| Item | Valor |
|---|---|
| **Red** | Polygon Mainnet (Chain ID 137) |
| **Token USDC** | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| **Contrato InstantPayment (Proxy UUPS)** | `0x971da9d642C94f6B5E3867EC891FBA7ef8287d29` |
| **Versión del contrato** | `2.0.0` |
| **Explorer** | [PolygonScan](https://polygonscan.com/address/0x971da9d642C94f6B5E3867EC891FBA7ef8287d29) |
| **Monto máximo por policy** | 20,000 USDC (configurable por el cliente) |
| **Timeout webhook** | 10 segundos por intento |
| **Reintentos de webhook** | 5 (backoff exponencial: 1s, 2s, 4s, 8s) |
| **Reintentos de transferencia** | 10 (configurable vía env `IP_MAX_RETRIES`) |
| **Precisión USDC** | 6 decimales |

---

*Documento generado por Spectral Celestial — 2026-03-04*
