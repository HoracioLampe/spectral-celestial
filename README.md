
---

## 🔒 Seguridad y Encriptación

### Almacenamiento de Private Keys

El sistema utiliza **encriptación AES-256-GCM** para almacenar private keys de manera segura en PostgreSQL.

**Características:**
- ✅ Encriptación de grado militar (AES-256)
- ✅ Autenticación de datos (GCM mode)
- ✅ Cache inteligente (7 min TTL)
- ✅ Backups automáticos (Railway PostgreSQL)

**Documentación completa:**
- [`docs/ENCRYPTION_ARCHITECTURE.md`](./docs/ENCRYPTION_ARCHITECTURE.md) - Arquitectura técnica
- [`docs/MIGRATION_GUIDE.md`](./docs/MIGRATION_GUIDE.md) - Guía de migración desde Vault

### Variables de Entorno Requeridas

```bash
# Encriptación
ENCRYPTION_KEY=<clave-aleatoria-32-chars>

# Base de datos
DATABASE_URL=<railway-postgresql-url>

# Blockchain
RPC_URL=<polygon-rpc-url>
CONTRACT_ADDRESS=<usdc-distributor-address>
```

---

## 📦 Versiones

**Actual:** `v1.0.0-encrypted-storage`

**Changelog:**
- **v1.0.0-encrypted-storage** (2026-01-13)
  - Migración de Vault a almacenamiento encriptado en PostgreSQL
  - Sistema de cache con TTL de 7 minutos
  - Probado con 1000 transacciones exitosas
  - Documentación completa agregada

---

## 🔧 Mantenimiento

### Rotación de ENCRYPTION_KEY

Si necesitas rotar la clave de encriptación:

1. Generar nueva clave:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

2. Ejecutar script de re-encriptación:
```bash
node scripts/rotate_encryption_key.js --old-key=<old> --new-key=<new>
```

3. Actualizar variable en Railway

### Backups

Railway realiza backups automáticos de PostgreSQL. Para backup manual:

```bash
# Exportar datos encriptados
pg_dump $DATABASE_URL > backup.sql
```

**Importante:** El backup incluye datos encriptados. Necesitas `ENCRYPTION_KEY` para usarlos.

---

## 📚 Documentación Adicional

- [`docs/ENCRYPTION_ARCHITECTURE.md`](./docs/ENCRYPTION_ARCHITECTURE.md) - Detalles de encriptación
- [`docs/MIGRATION_GUIDE.md`](./docs/MIGRATION_GUIDE.md) - Guía de migración
- [`walkthrough.md`](./walkthrough.md) - Resumen de la migración completada

---
