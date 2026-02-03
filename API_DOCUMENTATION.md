# Documentación de APIs - Spectral Celestial Backend

**Versión:** 3.3.2  
**Última actualización:** 2026-01-21  
**Framework:** Express.js + Node.js  
**Base de datos:** PostgreSQL  
**Blockchain:** Polygon (Mainnet - Chain ID 137)

---

## Tabla de Contenidos

1. [Introducción General](#introducción-general)
2. [Autenticación y Seguridad](#autenticación-y-seguridad)
3. [APIs de Autenticación](#apis-de-autenticación)
4. [APIs de Lotes (Batches)](#apis-de-lotes-batches)
5. [APIs de Transacciones](#apis-de-transacciones)
6. [APIs de Faucets](#apis-de-faucets)
7. [APIs de Relayers](#apis-de-relayers)
8. [APIs de Merkle Trees](#apis-de-merkle-trees)
9. [APIs de Administración](#apis-de-administración)
10. [APIs de Recuperación de Fondos](#apis-de-recuperación-de-fondos)
11. [APIs de Configuración y Diagnóstico](#apis-de-configuración-y-diagnóstico)
12. [Códigos de Error Comunes](#códigos-de-error-comunes)
13. [Límites y Consideraciones](#límites-y-consideraciones)
14. [Casos de Uso Comunes](#casos-de-uso-comunes)

---

## Introducción General

Este backend proporciona una API RESTful completa para gestionar distribuciones masivas de USDC en Polygon utilizando un sistema de lotes (batches), árboles de Merkle, y relayers distribuidos para optimizar costos de gas.

### Características Principales

- **Autenticación Web3:** Sign-In with Ethereum (SIWE) + JWT
- **Distribución Masiva:** Procesamiento de miles de transacciones en paralelo
- **Optimización de Gas:** Sistema de relayers distribuidos
- **Verificación Merkle:** Pruebas criptográficas para cada transacción
- **Gestión de Faucets:** Wallets automáticas para financiamiento
- **Recuperación de Fondos:** Sistema automático de recuperación de gas no utilizado

### Tecnologías Utilizadas

- **Backend:** Express.js, Node.js
- **Base de Datos:** PostgreSQL con índices optimizados
- **Blockchain:** ethers.js v6, Polygon Mainnet
- **Autenticación:** SIWE (Sign-In with Ethereum), JWT
- **Almacenamiento Seguro:** HashiCorp Vault (para claves privadas)
- **Procesamiento de Archivos:** multer, xlsx, exceljs

---

## Autenticación y Seguridad

### Método de Autenticación

El sistema utiliza un flujo de autenticación en dos pasos:

1. **SIWE (Sign-In with Ethereum):** El usuario firma un mensaje con su wallet
2. **JWT (JSON Web Token):** El servidor emite un token JWT válido por 12 horas

### Flujo de Autenticación

```mermaid
sequenceDiagram
    participant Usuario
    participant Frontend
    participant Backend
    participant Blockchain
    
    Usuario->>Frontend: Conecta MetaMask/Ledger
    Frontend->>Backend: GET /api/auth/nonce
    Backend->>Frontend: { nonce: "abc123..." }
    Frontend->>Usuario: Solicita firma del mensaje
    Usuario->>Frontend: Firma con wallet
    Frontend->>Backend: POST /api/auth/verify { message, signature }
    Backend->>Backend: Verifica firma SIWE
    Backend->>Frontend: { token: "jwt...", address, role }
    Frontend->>Backend: Requests con header Authorization: Bearer jwt...
```

### Roles de Usuario

| Rol | Permisos | Descripción |
|-----|----------|-------------|
| `REGISTERED` | Lectura básica | Usuario registrado sin permisos operativos |
| `OPERATOR` | Crear y ejecutar lotes propios | Usuario operador estándar |
| `DENIED` | Sin acceso | Usuario bloqueado |
| `SUPER_ADMIN` | Acceso total | Administrador con permisos globales |

### Cómo Incluir el Token en las Peticiones

Todas las rutas protegidas requieren el header `Authorization`:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Ejemplo con fetch:**

```javascript
const response = await fetch('https://api.example.com/api/batches', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  }
});
```

**Ejemplo con curl:**

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://api.example.com/api/batches
```

---

## APIs de Autenticación

### 1. Obtener Nonce para Firma

**Endpoint:** `GET /api/auth/nonce`

**Descripción:** Genera un nonce único para que el usuario firme con su wallet.

**Autenticación:** No requerida

**Parámetros:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "nonce": "Kp3jX9mN2vQ8rT5wY"
}
```

**Códigos de Error:**

- `500` - Error al generar nonce (problema de sesión)

**Ejemplo de Uso:**

```javascript
// Frontend - Paso 1: Obtener nonce
const nonceResponse = await fetch('/api/auth/nonce');
const { nonce } = await nonceResponse.json();

// Paso 2: Crear mensaje SIWE
const message = new SiweMessage({
  domain: window.location.host,
  address: userAddress,
  statement: 'Iniciar sesión en Spectral Celestial',
  uri: window.location.origin,
  version: '1',
  chainId: 137,
  nonce: nonce
});

// Paso 3: Solicitar firma al usuario
const signature = await signer.signMessage(message.prepareMessage());
```

---

### 2. Verificar Firma y Obtener Token JWT

**Endpoint:** `POST /api/auth/verify`

**Descripción:** Verifica la firma SIWE y emite un token JWT válido por 12 horas.

**Autenticación:** No requerida (pero requiere nonce válido de sesión)

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `message` | string | Sí | Mensaje SIWE serializado |
| `signature` | string | Sí | Firma hexadecimal del mensaje |

**Respuesta Exitosa (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb4",
  "role": "OPERATOR"
}
```

**Códigos de Error:**

- `400` - Firma inválida
- `422` - Sesión expirada o nonce perdido

**Ejemplo de Uso:**

```javascript
const verifyResponse = await fetch('/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: message.toMessage(),
    signature: signature
  })
});

const { token, address, role } = await verifyResponse.json();
localStorage.setItem('jwt_token', token);
```

---

## APIs de Lotes (Batches)

Los lotes son contenedores de transacciones que se procesan en conjunto.

### 3. Listar Lotes del Usuario

**Endpoint:** `GET /api/batches`

**Descripción:** Obtiene todos los lotes del usuario autenticado (o todos si es SUPER_ADMIN).

**Autenticación:** JWT requerido

**Parámetros de Query:**

| Parámetro | Tipo | Requerido | Descripción | Ejemplo |
|-----------|------|-----------|-------------|---------|
| `page` | integer | No | Número de página (default: 1) | `page=2` |
| `limit` | integer | No | Items por página (default: 20) | `limit=50` |
| `date` | string | No | Filtrar por fecha (YYYY-MM-DD) | `date=2026-01-21` |
| `status` | string | No | Filtrar por estado | `status=COMPLETED` |
| `description` | string | No | Búsqueda parcial en descripción | `description=Nómina` |
| `amount` | number | No | Filtrar por monto (±10%) | `amount=1000` |

**Estados Posibles de Lotes:**

- `PREPARING` - Lote creado, sin transacciones
- `READY` - Transacciones cargadas, listo para ejecutar
- `PROCESSING` - Ejecución en progreso
- `COMPLETED` - Todas las transacciones completadas
- `FAILED` - Ejecución fallida
- `SENT` - Enviado pero no confirmado

**Respuesta Exitosa (200):**

```json
{
  "batches": [
    {
      "id": 247,
      "batch_number": "BATCH-2026-001",
      "description": "Nómina Enero 2026",
      "detail": "Pago quincenal empleados",
      "status": "COMPLETED",
      "total_transactions": 150,
      "sent_transactions": 150,
      "total_usdc": "75000000000",
      "funder_address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb4",
      "merkle_root": "0x1a2b3c...",
      "created_at": "2026-01-15T10:30:00.000Z",
      "updated_at": "2026-01-15T11:45:00.000Z"
    }
  ],
  "pagination": {
    "totalItems": 42,
    "currentPage": 1,
    "totalPages": 3,
    "itemsPerPage": 20
  }
}
```

**Nota sobre Montos:** Los montos USDC se almacenan en microUSDC (6 decimales). Ejemplo: `75000000000` = 75,000 USDC.

**Códigos de Error:**

- `401` - Token faltante o inválido
- `500` - Error de base de datos

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/batches?page=1&limit=20&status=COMPLETED', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { batches, pagination } = await response.json();
```

---

### 4. Obtener Detalles de un Lote

**Endpoint:** `GET /api/batches/:id`

**Descripción:** Obtiene información detallada de un lote específico y estadísticas de transacciones.

**Autenticación:** No requerida (público para polling)

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Respuesta Exitosa (200):**

```json
{
  "batch": {
    "id": 247,
    "batch_number": "BATCH-2026-001",
    "description": "Nómina Enero 2026",
    "status": "COMPLETED",
    "total_transactions": 150,
    "total_usdc": "75000000000",
    "merkle_root": "0x1a2b3c4d...",
    "funder_address": "0x742d35cc...",
    "created_at": "2026-01-15T10:30:00.000Z"
  },
  "stats": {
    "total": 150,
    "completed": 148,
    "failed": 2,
    "pending": 0,
    "sending": 0,
    "queued": 0
  }
}
```

**Códigos de Error:**

- `404` - Lote no encontrado

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/batches/247');
const { batch, stats } = await response.json();
console.log(`Progreso: ${stats.completed}/${stats.total}`);
```

---

### 5. Crear Nuevo Lote

**Endpoint:** `POST /api/batches`

**Descripción:** Crea un nuevo lote vacío.

**Autenticación:** JWT requerido

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `batch_number` | string | Sí | Número identificador del lote |
| `description` | string | No | Descripción breve |
| `detail` | string | No | Detalles adicionales |

**Respuesta Exitosa (200):**

```json
{
  "id": 248,
  "batch_number": "BATCH-2026-002",
  "description": "Nómina Febrero",
  "detail": "Pago quincenal",
  "status": "PREPARING",
  "funder_address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb4",
  "created_at": "2026-01-21T14:30:00.000Z"
}
```

**Códigos de Error:**

- `401` - No autenticado
- `500` - Error al crear lote

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/batches', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    batch_number: 'BATCH-2026-002',
    description: 'Nómina Febrero 2026',
    detail: 'Pago quincenal empleados'
  })
});
const newBatch = await response.json();
```

---

### 6. Cargar Transacciones desde Excel

**Endpoint:** `POST /api/batches/:id/upload`

**Descripción:** Carga transacciones desde un archivo Excel (.xlsx) al lote.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Parámetros del Body (multipart/form-data):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| [file](file:///c:/Users/familia/.gemini/antigravity/playground/spectral-celestial/Procfile) | file | Sí | Archivo Excel (.xlsx) |

**Formato del Excel:**

El archivo debe contener las siguientes columnas (case-insensitive):

| Columna | Descripción | Ejemplo |
|---------|-------------|---------|
| `Wallet` o `Address` | Dirección Ethereum del destinatario | 0x742d35cc... |
| `Amount` o `USDC` | Cantidad en microUSDC (6 decimales) | 1000000 (= 1 USDC) |
| `Reference` o `Ref` | Referencia opcional | EMP-001 |

**Ejemplo de Excel:**

| Wallet | Amount | Reference |
|--------|--------|-----------|
| 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEB4 | 5000000 | EMP-001 |
| 0x1234567890123456789012345678901234567890 | 10000000 | EMP-002 |

**Respuesta Exitosa (200):**

```json
{
  "batch": {
    "id": 248,
    "total_transactions": 150,
    "total_usdc": "75000000",
    "status": "READY"
  },
  "transactions": [
    {
      "id": 5001,
      "batch_id": 248,
      "wallet_address_to": "0x742d35cc...",
      "amount_usdc": "5000000",
      "transaction_reference": "EMP-001",
      "status": "PENDING"
    }
  ]
}
```

**Códigos de Error:**

- `403` - No eres el propietario del lote
- `404` - Lote no encontrado
- `500` - Error al procesar archivo (formato inválido, direcciones inválidas, etc.)

**Ejemplo de Uso:**

```javascript
const formData = new FormData();
formData.append('file', excelFile);

const response = await fetch('/api/batches/248/upload', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
const result = await response.json();
```

---

### 7. Generar Árbol de Merkle

**Endpoint:** `POST /api/batches/:id/register-merkle`

**Descripción:** Genera el árbol de Merkle para todas las transacciones del lote.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Parámetros del Body:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "root": "0x1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890"
}
```

**Códigos de Error:**

- `403` - No eres el propietario del lote
- `500` - Error al generar árbol (sin transacciones, error de cálculo)

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/batches/248/register-merkle', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
const { root } = await response.json();
console.log('Merkle Root:', root);
```

**Nota Técnica:** El árbol de Merkle se construye usando:
- Codificación ABI: `[chainId, contractAddress, batchId, txId, funder, recipient, amount]`
- Hash: `keccak256`
- Ordenamiento de hermanos: `BigInt(hash1) < BigInt(hash2)`

---

### 8. Configurar Relayers

**Endpoint:** `POST /api/batches/:id/setup`

**Descripción:** Crea y financia wallets relayers para ejecutar el lote en paralelo.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `relayerCount` | integer | No | Número de relayers (default: 5, max: 100) |

**Respuesta Exitosa (200):**

```json
{
  "message": "Relayers created and funded",
  "count": 10
}
```

**Códigos de Error:**

- `403` - No eres el propietario del lote
- `404` - Lote no encontrado
- `500` - Error al crear relayers (faucet sin fondos, error de blockchain)

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/batches/248/setup', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ relayerCount: 10 })
});
```

**Consideraciones:**
- Cada relayer requiere ~0.05 POL para gas
- El faucet del usuario debe tener suficiente POL
- Límite máximo: 100 relayers (para evitar límite de gas del bloque)

---

### 9. Ejecutar Lote

**Endpoint:** `POST /api/batches/:id/execute`

**Descripción:** Inicia la ejecución del lote con las firmas requeridas (Permit USDC y Merkle Root).

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `permitData` | object | Sí | Datos de firma EIP-2612 para USDC |
| `rootSignatureData` | object | Sí | Firma del Merkle Root |

**Estructura de `permitData`:**

```json
{
  "owner": "0x742d35cc...",
  "spender": "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5",
  "value": "75000000",
  "deadline": 1737565200,
  "v": 27,
  "r": "0x1a2b3c...",
  "s": "0x4d5e6f..."
}
```

**Estructura de `rootSignatureData`:**

```json
{
  "merkleRoot": "0x1a2b3c4d...",
  "signature": "0xabcdef..."
}
```

**Respuesta Exitosa (200):**

```json
{
  "message": "Batch execution started",
  "batchId": 248
}
```

**Códigos de Error:**

- `400` - Merkle Root no generado
- `403` - No eres el propietario del lote
- `404` - Lote no encontrado
- `500` - Error al ejecutar (firma inválida, fondos insuficientes)

**Ejemplo de Uso:**

```javascript
// 1. Firmar Permit USDC (EIP-2612)
const permitSignature = await signPermit(signer, usdcContract, spender, amount, deadline);

// 2. Firmar Merkle Root
const rootSignature = await signer.signMessage(ethers.getBytes(merkleRoot));

// 3. Ejecutar lote
const response = await fetch('/api/batches/248/execute', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    permitData: permitSignature,
    rootSignatureData: {
      merkleRoot: merkleRoot,
      signature: rootSignature
    }
  })
});
```

---

## APIs de Transacciones

### 10. Listar Transacciones de un Lote

**Endpoint:** `GET /api/batches/:id/transactions`

**Descripción:** Obtiene las transacciones de un lote con paginación y filtros.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Parámetros de Query:**

| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `page` | integer | Número de página (default: 1) | `page=2` |
| `limit` | integer | Items por página (default: 10) | `limit=50` |
| `wallet` | string | Filtrar por dirección (búsqueda parcial) | `wallet=0x742d` |
| `status` | string | Filtrar por estado | `status=COMPLETED` |
| `amount` | number | Filtrar por monto exacto (USDC) | `amount=5` |

**Estados de Transacciones:**

- `PENDING` - Pendiente de envío
- `QUEUED` - En cola de procesamiento
- `ENVIANDO` - Siendo enviada
- `WAITING_CONFIRMATION` - Esperando confirmación blockchain
- `COMPLETED` - Completada exitosamente
- `FAILED` - Fallida

**Respuesta Exitosa (200):**

```json
{
  "transactions": [
    {
      "id": 5001,
      "batch_id": 248,
      "wallet_address_to": "0x742d35cc6634c0532925a3b844bc9e7595f0beb4",
      "amount_usdc": "5000000",
      "amount_transferred": "5000000",
      "tx_hash": "0xabcdef1234567890...",
      "status": "COMPLETED",
      "transaction_reference": "EMP-001",
      "relayer_address": "0x9876543210...",
      "retry_count": 0,
      "updated_at": "2026-01-21T15:30:00.000Z"
    }
  ],
  "total": 150,
  "page": 1,
  "totalPages": 15
}
```

**Códigos de Error:**

- `403` - No tienes acceso a este lote
- `404` - Lote no encontrado

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/batches/248/transactions?page=1&limit=50&status=COMPLETED', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { transactions, total } = await response.json();
```

---

### 11. Exportar Transacciones (para Excel)

**Endpoint:** `GET /api/transactions`

**Descripción:** Obtiene todas las transacciones de un lote con filtros (usado para exportación a Excel).

**Autenticación:** JWT requerido

**Parámetros de Query:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `batchId` | integer | Sí | ID del lote |
| `wallet` | string | No | Filtrar por dirección |
| `status` | string | No | Filtrar por estado |
| `amount` | string | No | Filtrar por monto |

**Respuesta Exitosa (200):**

```json
[
  {
    "id": 5001,
    "recipient_address": "0x742d35cc...",
    "amount": "5000000",
    "amount_sent": "5000000",
    "tx_hash": "0xabcdef...",
    "status": "COMPLETED",
    "timestamp": "2026-01-21T15:30:00.000Z"
  }
]
```

**Códigos de Error:**

- `400` - batchId es requerido
- `403` - Solo puedes exportar tus propios lotes
- `404` - Lote no encontrado

---

### 12. Obtener ID de Primera Transacción

**Endpoint:** `GET /api/batches/:id/first-transaction`

**Descripción:** Obtiene el ID de la primera transacción del lote (para numeración secuencial en Excel).

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Respuesta Exitosa (200):**

```json
{
  "firstId": 5001
}
```

---

### 13. Obtener Prueba de Merkle

**Endpoint:** `GET /api/batches/:batchId/transactions/:txId/proof`

**Descripción:** Obtiene la prueba de Merkle para una transacción específica.

**Autenticación:** No requerida

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `batchId` | integer | ID del lote |
| `txId` | integer | ID de la transacción |

**Respuesta Exitosa (200):**

```json
{
  "proof": [
    "0x1a2b3c4d...",
    "0x5e6f7890...",
    "0xabcdef12..."
  ]
}
```

**Uso:** Esta prueba se puede usar para verificar on-chain que una transacción pertenece al lote.

---

## APIs de Faucets

Los faucets son wallets automáticas que financian los relayers con POL (gas).

### 14. Obtener Faucet del Usuario

**Endpoint:** `GET /api/faucet`

**Descripción:** Obtiene el faucet asociado al usuario autenticado (o lo crea automáticamente).

**Autenticación:** JWT requerido

**Parámetros:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "address": "0x9876543210abcdef...",
  "privateKey": "0x1234567890abcdef...",
  "balance": "5.234567",
  "usdcBalance": "1000.500000",
  "gasReserve": "0.05",
  "feeData": {
    "maxFeePerGas": "50000000000",
    "maxPriorityFeePerGas": "30000000000"
  }
}
```

**Campos de Respuesta:**

| Campo | Descripción |
|-------|-------------|
| `address` | Dirección del faucet |
| `privateKey` | Clave privada (⚠️ manejar con cuidado) |
| `balance` | Balance de POL (MATIC) |
| `usdcBalance` | Balance de USDC |
| `gasReserve` | POL reservado estimado para gas |
| `feeData` | Datos de fees actuales de la red |

**Códigos de Error:**

- `500` - Error al obtener/crear faucet

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/faucet', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const faucet = await response.json();
console.log(`Faucet: ${faucet.address}, Balance: ${faucet.balance} POL`);
```

---

### 15. Regenerar Faucet

**Endpoint:** `POST /api/faucet/generate`

**Descripción:** Elimina el faucet actual y genera uno nuevo.

**Autenticación:** JWT requerido

**Parámetros:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "address": "0xnewfaucetaddress..."
}
```

**⚠️ Advertencia:** Esta acción eliminará el faucet anterior. Asegúrate de haber recuperado todos los fondos antes.

---

### 16. Enviar POL desde Faucet

**Endpoint:** `POST /api/faucet/send-pol`

**Descripción:** Envía POL desde el faucet a una dirección específica.

**Autenticación:** No requerida (pero requiere funderAddress)

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `recipientAddress` | string | Sí | Dirección destino |
| `amount` | number | Sí | Cantidad en POL (ej: 0.5) |
| `funderAddress` | string | Sí | Dirección del propietario del faucet |

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "txHash": "0xabcdef1234567890...",
  "amount": "0.5",
  "recipient": "0x742d35cc...",
  "gasUsed": "0.00021",
  "explorerUrl": "https://polygonscan.com/tx/0xabcdef..."
}
```

**Códigos de Error:**

- `400` - Dirección inválida, monto inválido, o fondos insuficientes
- `401` - Funder address requerido
- `500` - Error al enviar transacción

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/faucet/send-pol', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    recipientAddress: '0x742d35cc6634c0532925a3b844bc9e7595f0beb4',
    amount: 0.5,
    funderAddress: userAddress
  })
});
const result = await response.json();
```

---

## APIs de Relayers

### 17. Listar Relayers de un Lote

**Endpoint:** `GET /api/relayers/:batchId`

**Descripción:** Obtiene todos los relayers de un lote con balances actualizados en tiempo real.

**Autenticación:** No requerida

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `batchId` | integer | ID del lote |

**Respuesta Exitosa (200):**

```json
[
  {
    "id": 1001,
    "address": "0xrelayer1...",
    "status": "active",
    "balance": "0.0234",
    "db_balance": "0.0234",
    "tx_count": 15,
    "last_activity": "2026-01-21T15:30:00.000Z",
    "transactionhash_deposit": "0xdeposittx..."
  }
]
```

**Campos de Respuesta:**

| Campo | Descripción |
|-------|-------------|
| `balance` | Balance actual (consultado en blockchain) |
| `db_balance` | Balance almacenado en DB |
| `tx_count` | Número de transacciones procesadas |
| `status` | Estado: `active`, `drained`, [error](file:///c:/Users/familia/.gemini/antigravity/playground/spectral-celestial/server.js#169-172) |

**Nota:** El endpoint consulta balances en tiempo real en lotes de 5 para optimizar rendimiento.

---

### 18. Recuperar Fondos de un Relayer

**Endpoint:** `POST /api/relayer/:address/recover`

**Descripción:** Recupera el POL no utilizado de un relayer específico y lo envía de vuelta al faucet.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `address` | string | Dirección del relayer |

**Parámetros del Body:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "txHash": "0xrecoverytx...",
  "amount": "0.0234"
}
```

**Códigos de Error:**

- `400` - Fondos insuficientes
- `404` - Relayer no encontrado
- `500` - Error al recuperar fondos

**Ejemplo de Uso:**

```javascript
const response = await fetch('/api/relayer/0xrelayeraddress.../recover', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Características Especiales:**
- Auto-desbloqueo: Si el relayer tiene nonces bloqueados, intenta desbloquearlo automáticamente
- Gas optimizado: Usa 1.5x gas para asegurar confirmación rápida
- Actualización de DB: Marca el relayer como `drained` automáticamente

---

## APIs de Merkle Trees

Ya documentadas en sección de Lotes:
- [Generar Árbol de Merkle](#7-generar-árbol-de-merkle)
- [Obtener Prueba de Merkle](#13-obtener-prueba-de-merkle)

---

## APIs de Administración

Estas APIs requieren rol `SUPER_ADMIN`.

### 19. Ejecutar SQL Directo

**Endpoint:** `POST /api/admin/sql`

**Descripción:** Ejecuta una consulta SQL directa en la base de datos.

**Autenticación:** JWT requerido (SUPER_ADMIN)

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `query` | string | Sí | Consulta SQL |

**Respuesta Exitosa (200):**

```json
{
  "rows": [...],
  "rowCount": 42,
  "fields": [...]
}
```

**⚠️ Advertencia:** Esta API es extremadamente poderosa. Úsala solo para diagnóstico.

---

### 20. Desbloquear Faucets

**Endpoint:** `POST /api/admin/unblock-faucets`

**Descripción:** Verifica y repara faucets con nonces bloqueados.

**Autenticación:** JWT requerido (SUPER_ADMIN)

**Parámetros del Body:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "summary": {
    "total": 10,
    "clean": 7,
    "blocked": 2,
    "repaired": 2,
    "failed": 1
  },
  "results": [...]
}
```

---

### 21. Estado de Rescate Global

**Endpoint:** `GET /api/admin/rescue-status`

**Descripción:** Obtiene el estado de todos los relayers pendientes de recuperación.

**Autenticación:** JWT requerido (SUPER_ADMIN)

**Parámetros de Query:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `batchId` | integer | Filtrar por lote específico (opcional) |

**Respuesta Exitosa (200):**

```json
{
  "relayers": [...],
  "summary": {
    "total": 500,
    "pending": 50,
    "processing": 0,
    "completed": 445,
    "failed": 5,
    "totalBalance": "12.5678 MATIC"
  }
}
```

---

### 22. Ejecutar Rescate Global

**Endpoint:** `POST /api/admin/rescue-execute`

**Descripción:** Ejecuta la recuperación de fondos de todos los relayers pendientes.

**Autenticación:** JWT requerido (SUPER_ADMIN)

**Parámetros del Body (JSON):**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `batchId` | integer | No | Lote específico (o todos si se omite) |

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "message": "Admin rescue process completed.",
  "batches_processed": 10,
  "results": [...]
}
```

---

## APIs de Recuperación de Fondos

### 23. Recuperar Fondos de un Lote

**Endpoint:** `POST /api/batches/:id/return-funds`

**Descripción:** Recupera todos los fondos no utilizados de los relayers de un lote.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `id` | integer | ID del lote |

**Parámetros del Body:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "message": "Recovery process completed. Recovered: 2.5 MATIC"
}
```

**Códigos de Error:**

- `403` - No eres el propietario del lote
- `404` - Lote no encontrado
- `500` - Error al recuperar fondos

---

### 24. Lotes con Fondos Recuperables

**Endpoint:** `GET /api/recovery/batches`

**Descripción:** Lista todos los lotes del usuario que tienen fondos recuperables.

**Autenticación:** JWT requerido

**Parámetros:** Ninguno

**Respuesta Exitosa (200):**

```json
[
  {
    "id": 247,
    "total_transactions": 150,
    "batch_status": "COMPLETED",
    "total_relayers": 10,
    "total_pol": "2.5678",
    "funder_address": "0x742d35cc..."
  }
]
```

**Filtro:** Solo muestra lotes con más de 0.001 POL recuperable.

---

## APIs de Configuración y Diagnóstico

### 25. Obtener Configuración del Sistema

**Endpoint:** `GET /api/config`

**Descripción:** Obtiene la configuración pública del sistema.

**Autenticación:** No requerida

**Parámetros:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "RPC_URL": "https://polygon-mainnet...",
  "WS_RPC_URL": "wss://polygon-mainnet...",
  "CONTRACT_ADDRESS": "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5",
  "CHAIN_ID": 137,
  "PERMIT_DEADLINE_SECONDS": 7200
}
```

---

### 26. Health Check

**Endpoint:** `GET /api/health`

**Descripción:** Verifica el estado del servidor y la conexión a la base de datos.

**Autenticación:** No requerida

**Parámetros:** Ninguno

**Respuesta Exitosa (200):**

```json
{
  "status": "ok",
  "db": "connected",
  "uptime": 123456.78
}
```

**Códigos de Error:**

- `500` - Base de datos desconectada

---

### 27. Health Check Detallado

**Endpoint:** `GET /api/health-check`

**Descripción:** Health check con información de versión y endpoints disponibles.

**Autenticación:** No requerida

**Respuesta Exitosa (200):**

```json
{
  "status": "OK",
  "version": "3.3.2-excel-export",
  "timestamp": "2026-01-21T18:30:00.000Z",
  "endpoints": {
    "transactions": "available",
    "firstTransaction": "available"
  }
}
```

---

### 28. Debug de Sistema

**Endpoint:** `GET /api/debug`

**Descripción:** Información detallada del sistema para diagnóstico.

**Autenticación:** No requerida

**Respuesta Exitosa (200):**

```json
{
  "database": {
    "url": "postgres://user:****@host:5432/db",
    "status": "connected",
    "poolSize": 10,
    "idleCount": 8,
    "waitingCount": 0
  },
  "session": {
    "storeType": "PGStore"
  },
  "vault": {
    "initialized": true,
    "sealed": false,
    "version": "1.15.0"
  },
  "environment": {
    "nodeEnv": "production",
    "port": 3000,
    "version": "2.6.1-reactive-unseal",
    "vault_addr": "http://vault...",
    "persistent_volume": "MOUNTED"
  }
}
```

---

### 29. Obtener Balances de Usuario

**Endpoint:** `GET /api/balances/:address`

**Descripción:** Obtiene los balances de POL y USDC de una dirección.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `address` | string | Dirección Ethereum |

**Restricción de Seguridad:** Solo puedes consultar tu propia dirección.

**Respuesta Exitosa (200):**

```json
{
  "matic": "5.234567",
  "usdc": "1000.500000",
  "allowance": "75000.000000"
}
```

**Campos:**

| Campo | Descripción |
|-------|-------------|
| `matic` | Balance de POL (MATIC) |
| `usdc` | Balance de USDC |
| `allowance` | USDC aprobado para el contrato |

---

### 30. Obtener Nonce del Contrato

**Endpoint:** `GET /api/contract/nonce/:address`

**Descripción:** Obtiene el nonce del contrato BatchDistributor para una dirección.

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `address` | string | Dirección Ethereum |

**Respuesta Exitosa (200):**

```json
{
  "nonce": "5"
}
```

**Uso:** Necesario para firmar el Merkle Root con EIP-712.

---

### 31. Obtener Nonce de USDC

**Endpoint:** `GET /api/usdc/nonce/:address`

**Descripción:** Obtiene el nonce de USDC para firmas Permit (EIP-2612).

**Autenticación:** JWT requerido

**Parámetros de Ruta:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `address` | string | Dirección Ethereum |

**Respuesta Exitosa (200):**

```json
{
  "nonce": "12"
}
```

**Uso:** Necesario para firmar Permit de USDC.

---

## Códigos de Error Comunes

| Código | Significado | Causas Comunes |
|--------|-------------|----------------|
| `400` | Bad Request | Parámetros inválidos, datos faltantes |
| `401` | Unauthorized | Token JWT faltante o inválido |
| `403` | Forbidden | No tienes permisos (rol insuficiente o no eres propietario) |
| `404` | Not Found | Recurso no encontrado (lote, transacción, etc.) |
| `422` | Unprocessable Entity | Sesión expirada, nonce perdido |
| `500` | Internal Server Error | Error de servidor, base de datos, o blockchain |

### Estructura de Respuesta de Error

```json
{
  "error": "Descripción del error en español"
}
```

**Ejemplo:**

```json
{
  "error": "Batch not found"
}
```

---

## Límites y Consideraciones

### Rate Limiting

Actualmente no hay rate limiting implementado, pero se recomienda:
- Máximo 100 requests por minuto por usuario
- Evitar polling agresivo (usar intervalos de 5-10 segundos)

### Límites de Tamaño

| Recurso | Límite |
|---------|--------|
| Transacciones por lote | Sin límite técnico (recomendado: < 10,000) |
| Relayers por lote | 100 máximo |
| Tamaño de archivo Excel | 50 MB |
| Timeout de ejecución | 60 segundos por transacción |

### Consideraciones de Gas

- **Faucet mínimo:** 0.5 POL recomendado
- **Gas por relayer:** ~0.05 POL
- **Gas por transacción:** ~0.001-0.002 POL
- **Reserva de seguridad:** 1.5x del gas estimado

### Timeouts

| Operación | Timeout |
|-----------|---------|
| Confirmación de transacción | 60 segundos |
| Unseal de Vault | 5 segundos |
| Consulta RPC | 30 segundos |
| Sesión JWT | 12 horas |

---

## Casos de Uso Comunes

### Caso 1: Crear y Ejecutar un Lote Completo

```javascript
// 1. Autenticación
const { token } = await login(address, signature);

// 2. Crear lote
const batch = await createBatch('BATCH-2026-001', 'Nómina Enero');

// 3. Cargar transacciones desde Excel
await uploadExcel(batch.id, excelFile);

// 4. Generar Merkle Tree
const { root } = await generateMerkle(batch.id);

// 5. Firmar Permit USDC
const permitSig = await signPermit(signer, totalAmount);

// 6. Firmar Merkle Root
const rootSig = await signer.signMessage(ethers.getBytes(root));

// 7. Configurar relayers
await setupRelayers(batch.id, 10);

// 8. Ejecutar lote
await executeBatch(batch.id, permitSig, rootSig);

// 9. Monitorear progreso
const interval = setInterval(async () => {
  const { stats } = await getBatchDetails(batch.id);
  console.log(`Progreso: ${stats.completed}/${stats.total}`);
  if (stats.completed === stats.total) {
    clearInterval(interval);
    console.log('¡Lote completado!');
  }
}, 5000);
```

### Caso 2: Recuperar Fondos de Relayers

```javascript
// 1. Listar lotes con fondos recuperables
const batches = await fetch('/api/recovery/batches', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());

// 2. Recuperar fondos de cada lote
for (const batch of batches) {
  if (parseFloat(batch.total_pol) > 0.01) {
    await fetch(`/api/batches/${batch.id}/return-funds`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log(`Recuperados ${batch.total_pol} POL del lote ${batch.id}`);
  }
}
```

### Caso 3: Monitorear Estado de Transacciones

```javascript
// Polling cada 10 segundos
async function monitorBatch(batchId) {
  const response = await fetch(`/api/batches/${batchId}`);
  const { batch, stats } = await response.json();
  
  console.log(`Estado: ${batch.status}`);
  console.log(`Completadas: ${stats.completed}/${stats.total}`);
  console.log(`Fallidas: ${stats.failed}`);
  console.log(`Pendientes: ${stats.pending}`);
  
  if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
    return batch;
  }
  
  // Continuar monitoreando
  await new Promise(resolve => setTimeout(resolve, 10000));
  return monitorBatch(batchId);
}

const finalBatch = await monitorBatch(248);
```

### Caso 4: Verificar Transacción On-Chain

```javascript
// Obtener prueba de Merkle
const { proof } = await fetch(`/api/batches/248/transactions/5001/proof`)
  .then(r => r.json());

// Verificar en el contrato
const contract = new ethers.Contract(contractAddress, abi, provider);
const isValid = await contract.verifyProof(
  merkleRoot,
  proof,
  transactionLeaf
);

console.log('Transacción verificada:', isValid);
```

---

## Soporte y Recursos Adicionales

### Documentación Relacionada

- [Arquitectura del Sistema](file:///c:/Users/familia/.gemini/antigravity/playground/spectral-celestial/docs/SYSTEM_ARCHITECTURE.md)
- [Arquitectura de Encriptación](file:///c:/Users/familia/.gemini/antigravity/playground/spectral-celestial/docs/ENCRYPTION_ARCHITECTURE.md)
- [Guía de Migración](file:///c:/Users/familia/.gemini/antigravity/playground/spectral-celestial/docs/MIGRATION_GUIDE.md)

### Contratos Inteligentes

- **BatchDistributor:** `0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5`
- **USDC (Polygon):** `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`
- **Chain ID:** 137 (Polygon Mainnet)

### Exploradores de Blockchain

- **PolygonScan:** https://polygonscan.com
- **Verificar transacciones:** https://polygonscan.com/tx/{txHash}
- **Verificar contratos:** https://polygonscan.com/address/{contractAddress}

### Variables de Entorno Requeridas

```bash
# Blockchain
RPC_URL_1=https://polygon-mainnet...
RPC_URL_2=https://polygon-backup...
CHAIN_ID=137
CONTRACT_ADDRESS=0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5
USDC_ADDRESS=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359

# Base de Datos
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Autenticación
JWT_SECRET=your-secret-key
SESSION_SECRET=your-session-secret
SESSION_TIMEOUT_MINUTES=120

# Vault (opcional)
VAULT_ADDR=http://vault:8200
VAULT_TOKEN=your-vault-token
VAULT_UNSEAL_KEYS=key1,key2,key3

# Servidor
PORT=3000
NODE_ENV=production
```

---

## Glosario de Términos

| Término | Definición |
|---------|------------|
| **Batch (Lote)** | Conjunto de transacciones que se procesan juntas |
| **Faucet** | Wallet automática que financia relayers con POL |
| **Relayer** | Wallet temporal que ejecuta transacciones en paralelo |
| **Merkle Tree** | Estructura de datos criptográfica para verificación eficiente |
| **Merkle Root** | Hash raíz del árbol de Merkle |
| **Merkle Proof** | Conjunto de hashes para verificar una transacción |
| **SIWE** | Sign-In with Ethereum (autenticación Web3) |
| **JWT** | JSON Web Token (token de sesión) |
| **Permit (EIP-2612)** | Firma para aprobar USDC sin transacción on-chain |
| **POL (MATIC)** | Token nativo de Polygon para pagar gas |
| **microUSDC** | Unidad atómica de USDC (1 USDC = 1,000,000 microUSDC) |
| **Nonce** | Número secuencial de transacciones de una wallet |

---

**Fin de la Documentación**

Para preguntas o soporte técnico, consulta los archivos de documentación adicionales en el directorio `docs/` o contacta al equipo de desarrollo.
