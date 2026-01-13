# 🔒 Arquitectura de Encriptación

## Resumen

El sistema utiliza encriptación AES-256-GCM para almacenar private keys de manera segura en PostgreSQL, reemplazando la dependencia de HashiCorp Vault.

---

## Componentes

### 1. Servicio de Encriptación (`services/encryption.js`)

**Algoritmo:** AES-256-GCM (Advanced Encryption Standard - Galois/Counter Mode)

**Características:**
- **Confidencialidad:** Encripta los datos
- **Autenticación:** Detecta modificaciones no autorizadas
- **Integridad:** Garantiza que los datos no fueron alterados

**Implementación:**

```javascript
const crypto = require('crypto');

class EncryptionService {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.key = this.deriveKey();
    }

    deriveKey() {
        const secret = process.env.ENCRYPTION_KEY;
        // Deriva clave de 32 bytes usando scrypt
        return crypto.scryptSync(secret, 'salt', 32);
    }

    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        // Formato: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }

    decrypt(encryptedData) {
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];

        const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }
}
```

---

### 2. Cache de Keys (`services/keyCache.js`)

**Propósito:** Evitar desencriptación repetida de las mismas keys.

**Características:**
- **TTL:** 7 minutos
- **Auto-limpieza:** Cada 5 minutos
- **Singleton:** Una instancia compartida

**Implementación:**

```javascript
class KeyCache {
    constructor(ttlMinutes = 7) {
        this.cache = new Map();
        this.ttlMs = ttlMinutes * 60 * 1000;
    }

    set(address, privateKey) {
        this.cache.set(address.toLowerCase(), {
            key: privateKey,
            timestamp: Date.now()
        });
    }

    get(address) {
        const entry = this.cache.get(address.toLowerCase());
        if (!entry) return null;

        // Verificar expiración
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(address.toLowerCase());
            return null;
        }

        return entry.key;
    }
}

const keyCache = new KeyCache(7);
setInterval(() => keyCache.cleanExpired(), 5 * 60 * 1000);
```

---

## Flujo de Datos

### Guardar Private Key

```
1. Generar wallet
   ↓
2. Encriptar private key (AES-256-GCM)
   ↓
3. Guardar en PostgreSQL (columna encrypted_key)
   ↓
4. Cachear key desencriptada (7 min TTL)
```

### Recuperar Private Key

```
1. Consultar cache
   ↓
2. Si está en cache → Retornar
   ↓
3. Si NO está en cache:
   a. Leer de PostgreSQL
   b. Desencriptar
   c. Guardar en cache
   d. Retornar
```

---

## Esquema de Base de Datos

```sql
-- Tabla faucets
CREATE TABLE faucets (
    address VARCHAR(42) PRIMARY KEY,
    funder_address VARCHAR(42) NOT NULL,
    encrypted_key TEXT,  -- ← Private key encriptada
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla relayers
CREATE TABLE relayers (
    address VARCHAR(42) PRIMARY KEY,
    batch_id INTEGER,
    encrypted_key TEXT,  -- ← Private key encriptada
    status VARCHAR(20),
    last_balance VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Formato de Datos Encriptados

### Estructura

```
iv:authTag:encryptedData
```

### Ejemplo

```
a1b2c3d4e5f6789012345678901234:f7e8d9c0b1a2345678901234567890:9a8b7c6d5e4f3210abcdef...
│                                │                                │
│                                │                                └─ Datos encriptados
│                                └─ Tag de autenticación (GCM)
└─ Vector de inicialización (IV)
```

### Componentes

- **IV (16 bytes):** Aleatorio, único por encriptación
- **Auth Tag (16 bytes):** Para verificar integridad
- **Encrypted Data:** Private key encriptada

---

## Seguridad

### Fortalezas

1. **AES-256:** Estándar militar, prácticamente imposible de romper por fuerza bruta
2. **GCM Mode:** Detecta cualquier modificación de datos
3. **IV Aleatorio:** Cada encriptación es única
4. **Scrypt:** Derivación de clave resistente a ataques

### Consideraciones

1. **Protección de `ENCRYPTION_KEY`:**
   - Guardar en variables de entorno
   - No commitear en Git
   - Backup en múltiples lugares seguros

2. **Rotación de Keys:**
   - Considerar rotar `ENCRYPTION_KEY` periódicamente
   - Requiere re-encriptar todas las keys existentes

3. **Acceso a la Base de Datos:**
   - Si alguien roba DB + `ENCRYPTION_KEY` → Puede desencriptar
   - Solución: Proteger acceso a Railway/PostgreSQL

---

## Performance

### Benchmarks (1000 operaciones)

| Operación | Primera vez | Con cache |
|-----------|-------------|-----------|
| Encriptar | ~1ms | N/A |
| Desencriptar | ~1ms | ~0.001ms |
| Total (1000 tx) | ~1000ms | ~1ms |

### Optimizaciones

1. **Cache de 7 minutos:** Reduce desencriptaciones en 99%
2. **Singleton pattern:** Una instancia de cache compartida
3. **Auto-limpieza:** Previene memory leaks

---

## Migración desde Vault

### Antes (Vault)

```javascript
// Guardar
await vault.saveFaucetKey(address, privateKey);

// Recuperar
const privateKey = await vault.getFaucetKey(address);
```

### Después (Encrypted DB)

```javascript
// Guardar
const encryption = require('./encryption');
const encryptedKey = encryption.encrypt(privateKey);
await db.query('INSERT INTO faucets (encrypted_key) VALUES ($1)', [encryptedKey]);

// Recuperar
const row = await db.query('SELECT encrypted_key FROM faucets WHERE address = $1', [address]);
const privateKey = encryption.decrypt(row.encrypted_key);
```

---

## Troubleshooting

### Error: "ENCRYPTION_KEY not set"

**Causa:** Variable de entorno faltante  
**Solución:** Agregar `ENCRYPTION_KEY` en Railway

### Error: "Failed to decrypt data"

**Causa:** `ENCRYPTION_KEY` incorrecta o datos corruptos  
**Solución:** Verificar que la key no cambió

### Error: "Invalid encrypted data format"

**Causa:** Formato de datos incorrecto  
**Solución:** Verificar que el formato sea `iv:authTag:encrypted`

---

## Referencias

- [Node.js Crypto Documentation](https://nodejs.org/api/crypto.html)
- [AES-GCM Specification](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [Scrypt Algorithm](https://en.wikipedia.org/wiki/Scrypt)
