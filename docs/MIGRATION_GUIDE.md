# 📦 Guía de Migración: Vault → Encrypted Database

## Contexto

Esta guía documenta la migración de HashiCorp Vault a almacenamiento encriptado en PostgreSQL, realizada el 2026-01-13.

---

## Motivación

### Problemas con Vault

1. **Sin volumen persistente:** Vault perdía datos en cada restart
2. **Pérdida de fondos:** 3000 MATIC perdidos en faucet `0xe14b99363D029AD0E0723958a283dE0e9978D888`
3. **Complejidad:** Proceso de unseal complicado
4. **Latencia:** Llamadas de red para cada key

### Beneficios de Encrypted DB

1. **Persistencia garantizada:** PostgreSQL con backups automáticos
2. **Simplicidad:** Sin servicios adicionales
3. **Performance:** Cache local de 7 minutos
4. **Confiabilidad:** Railway respalda la base de datos

---

## Pasos de Migración

### 1. Preparación

#### 1.1 Crear Servicio de Encriptación

```bash
# Crear archivo
touch services/encryption.js
```

Ver implementación completa en [`ENCRYPTION_ARCHITECTURE.md`](./ENCRYPTION_ARCHITECTURE.md)

#### 1.2 Crear Cache de Keys

```bash
# Crear archivo
touch services/keyCache.js
```

#### 1.3 Agregar Variable de Entorno

En Railway:
```
ENCRYPTION_KEY=<generar-clave-aleatoria-32-chars>
```

**Generar clave segura:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

### 2. Migración de Base de Datos

#### 2.1 Agregar Columnas

```sql
-- En Railway PostgreSQL Console
ALTER TABLE faucets ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
ALTER TABLE relayers ADD COLUMN IF NOT EXISTS encrypted_key TEXT;
```

#### 2.2 Limpiar Datos Antiguos

```sql
-- Borrar faucets sin encrypted_key (del sistema viejo)
DELETE FROM faucets WHERE encrypted_key IS NULL;

-- Opcional: Borrar relayers viejos
DELETE FROM relayers WHERE encrypted_key IS NULL;
```

---

### 3. Migración de Código

#### 3.1 Actualizar `services/faucet.js`

**Antes:**
```javascript
const vault = require('./vault');

// Guardar
await vault.saveFaucetKey(address, privateKey);

// Recuperar
const privateKey = await vault.getFaucetKey(address);
```

**Después:**
```javascript
const encryption = require('./encryption');

// Guardar
const encryptedKey = encryption.encrypt(privateKey);
await client.query(`
    INSERT INTO faucets (address, funder_address, encrypted_key) 
    VALUES ($1, $2, $3)
`, [address, funder, encryptedKey]);

// Recuperar
const result = await client.query(`
    SELECT encrypted_key FROM faucets WHERE address = $1
`, [address]);
const privateKey = encryption.decrypt(result.rows[0].encrypted_key);
```

#### 3.2 Actualizar `services/relayerEngine.js`

**Cambios similares:**
- Reemplazar `vault.getRelayerKey()` con lectura de DB + decrypt
- Reemplazar `vault.saveRelayerKey()` con encrypt + guardar en DB
- Agregar cache para optimizar performance

#### 3.3 Actualizar `server.js`

**Remover:**
```javascript
const vault = require('./services/vault');
```

**Eliminar endpoints:**
- `/api/debug/audit-vault`
- `/api/emergency/extract-keys`

---

### 4. Testing

#### 4.1 Test Local

```bash
# Verificar encriptación
node scripts/test_encryption.js
```

#### 4.2 Test en Desarrollo

1. Hacer login con MetaMask
2. Verificar que se crea nuevo faucet
3. Verificar que `encrypted_key` no es NULL
4. Probar batch pequeño (2-3 transacciones)

#### 4.3 Test en Producción

1. Deploy a Railway
2. Login con cuenta nueva de MetaMask
3. Ejecutar batch de 1000 transacciones
4. Verificar 100% de éxito

---

### 5. Deployment

#### 5.1 Commit y Push

```bash
git add services/encryption.js services/keyCache.js
git add services/faucet.js services/relayerEngine.js
git add server.js
git commit -m "feat: migrate from Vault to encrypted database storage"
git push origin main
```

#### 5.2 Verificar Deployment

1. Railway → Deployments
2. Verificar que el deployment está en "Success"
3. Revisar logs para errores

#### 5.3 Crear Tag de Versión

```bash
git tag -a v1.0.0-encrypted-storage -m "Stable: Encrypted DB storage"
git push origin v1.0.0-encrypted-storage
```

---

## Rollback (Si es necesario)

### Opción 1: Revertir Código

```bash
git revert HEAD
git push origin main
```

### Opción 2: Volver a Tag Anterior

```bash
git checkout <tag-anterior>
git push origin main --force
```

**Nota:** Las columnas `encrypted_key` quedarán en la DB pero no afectarán el funcionamiento.

---

## Verificación Post-Migración

### Checklist

- [ ] Variable `ENCRYPTION_KEY` configurada en Railway
- [ ] Columnas `encrypted_key` agregadas a `faucets` y `relayers`
- [ ] Faucets antiguos sin `encrypted_key` eliminados
- [ ] Código desplegado sin errores
- [ ] Login funciona correctamente
- [ ] Nuevos faucets se crean con `encrypted_key`
- [ ] Batch de prueba ejecutado exitosamente
- [ ] Logs sin errores de Vault

### Queries de Verificación

```sql
-- Verificar que todos los faucets tienen encrypted_key
SELECT COUNT(*) FROM faucets WHERE encrypted_key IS NULL;
-- Resultado esperado: 0

-- Ver faucets recientes
SELECT address, funder_address, 
       LEFT(encrypted_key, 50) as encrypted_preview,
       created_at 
FROM faucets 
ORDER BY created_at DESC 
LIMIT 5;
```

---

## Limpieza Post-Migración

### Opcional: Eliminar Vault Service

1. Railway → `vault-railway-template`
2. Settings → Delete Service

### Archivar Scripts de Vault

```bash
mkdir archive
mv scripts/*vault* archive/
mv scripts/emergency_key_extraction.js archive/
```

### Actualizar `.gitignore`

```bash
echo "archive/" >> .gitignore
```

---

## Troubleshooting

### Problema: "Missing identity" en login

**Causa:** MetaMask tiene sesión en caché con faucet antiguo  
**Solución:**
1. Desconectar MetaMask de la app
2. Usar otra cuenta de MetaMask
3. O limpiar sesiones: `DELETE FROM sessions;`

### Problema: "ENCRYPTION_KEY not set"

**Causa:** Variable de entorno faltante  
**Solución:** Agregar en Railway → Variables

### Problema: Deployment falla

**Causa:** Posible error de sintaxis  
**Solución:** Revisar logs de Railway, corregir y redeploy

---

## Métricas de Éxito

### Antes de la Migración

- ❌ Vault perdía datos en restarts
- ❌ 3000 MATIC perdidos
- ⚠️ Complejidad de unseal
- ⚠️ Latencia de red

### Después de la Migración

- ✅ Persistencia garantizada (PostgreSQL)
- ✅ 1000 transacciones probadas (100% éxito)
- ✅ Sistema simplificado
- ✅ Performance optimizado (cache 7 min)

---

## Contacto y Soporte

Para preguntas sobre esta migración:
- Revisar documentación en `docs/`
- Consultar logs de Railway
- Verificar tag `v1.0.0-encrypted-storage`
