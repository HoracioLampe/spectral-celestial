-- ============================================
-- SPECTRAL CELESTIAL - Complete Database Schema
-- Version: v1.0.0-encrypted-storage
-- Date: 2026-01-13
-- ============================================

-- IMPORTANTE: Este schema incluye encriptación de private keys
-- Requiere variable de entorno: ENCRYPTION_KEY

-- ============================================
-- EXTENSIONS
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Tabla: faucets
-- Almacena wallets faucet con private keys encriptadas
CREATE TABLE IF NOT EXISTS faucets (
    address VARCHAR(42) PRIMARY KEY,
    funder_address VARCHAR(42) NOT NULL,
    encrypted_key TEXT,  -- Private key encriptada con AES-256-GCM
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para faucets
CREATE INDEX IF NOT EXISTS idx_faucets_funder ON faucets(funder_address);
CREATE INDEX IF NOT EXISTS idx_faucets_created ON faucets(created_at DESC);

-- Constraint único: Un funder solo puede tener un faucet
CREATE UNIQUE INDEX IF NOT EXISTS idx_faucets_unique_funder ON faucets(funder_address);

-- ============================================

-- Tabla: relayers
-- Almacena wallets relayer con private keys encriptadas
CREATE TABLE IF NOT EXISTS relayers (
    address VARCHAR(42) PRIMARY KEY,
    batch_id INTEGER,
    encrypted_key TEXT,  -- Private key encriptada con AES-256-GCM
    status VARCHAR(20) DEFAULT 'ACTIVE',
    last_balance VARCHAR(50) DEFAULT '0',
    vault_status VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para relayers
CREATE INDEX IF NOT EXISTS idx_relayers_batch ON relayers(batch_id);
CREATE INDEX IF NOT EXISTS idx_relayers_status ON relayers(status);
CREATE INDEX IF NOT EXISTS idx_relayers_created ON relayers(created_at DESC);

-- ============================================

-- Tabla: batches
-- Almacena información de batches de transacciones
CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    funder_address VARCHAR(42) NOT NULL,
    merkle_root VARCHAR(66),
    total_transactions INTEGER NOT NULL,
    sent_transactions INTEGER DEFAULT 0,
    completed_transactions INTEGER DEFAULT 0,
    failed_transactions INTEGER DEFAULT 0,
    pending_transactions INTEGER DEFAULT 0,
    total_amount_usdc BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'PREPARING',
    detail TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para batches
CREATE INDEX IF NOT EXISTS idx_batches_funder ON batches(funder_address);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created ON batches(created_at DESC);

-- ============================================

-- Tabla: batch_transactions
-- Almacena transacciones individuales dentro de batches
CREATE TABLE IF NOT EXISTS batch_transactions (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    tx_id INTEGER NOT NULL,
    recipient_address VARCHAR(42) NOT NULL,
    amount_usdc BIGINT NOT NULL,
    proof JSONB,
    status VARCHAR(20) DEFAULT 'PENDING',
    tx_hash VARCHAR(66),
    relayer_address VARCHAR(42),
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para batch_transactions
CREATE INDEX IF NOT EXISTS idx_batch_tx_batch ON batch_transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_tx_status ON batch_transactions(status);
CREATE INDEX IF NOT EXISTS idx_batch_tx_recipient ON batch_transactions(recipient_address);
CREATE INDEX IF NOT EXISTS idx_batch_tx_hash ON batch_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_batch_tx_relayer ON batch_transactions(relayer_address);

-- Constraint único: Un tx_id único por batch
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_tx_unique ON batch_transactions(batch_id, tx_id);

-- ============================================

-- Tabla: rbac_users
-- Control de acceso basado en roles
CREATE TABLE IF NOT EXISTS rbac_users (
    address VARCHAR(42) PRIMARY KEY,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    name VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para rbac_users
CREATE INDEX IF NOT EXISTS idx_rbac_role ON rbac_users(role);

-- ============================================

-- Tabla: sessions
-- Almacena sesiones de usuario (express-session)
CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR(255) PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP NOT NULL
);

-- Índices para sessions
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

-- ============================================

-- Tabla: permits
-- Almacena permisos EIP-2612 para USDC
CREATE TABLE IF NOT EXISTS permits (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    funder_address VARCHAR(42) NOT NULL,
    deadline BIGINT NOT NULL,
    v INTEGER NOT NULL,
    r VARCHAR(66) NOT NULL,
    s VARCHAR(66) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para permits
CREATE INDEX IF NOT EXISTS idx_permits_batch ON permits(batch_id);
CREATE INDEX IF NOT EXISTS idx_permits_funder ON permits(funder_address);

-- Constraint único: Un permit por batch
CREATE UNIQUE INDEX IF NOT EXISTS idx_permits_unique_batch ON permits(batch_id);

-- ============================================

-- Tabla: merkle_signatures
-- Almacena firmas de Merkle roots
CREATE TABLE IF NOT EXISTS merkle_signatures (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    funder_address VARCHAR(42) NOT NULL,
    merkle_root VARCHAR(66) NOT NULL,
    total_transactions INTEGER NOT NULL,
    total_amount BIGINT NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para merkle_signatures
CREATE INDEX IF NOT EXISTS idx_merkle_batch ON merkle_signatures(batch_id);
CREATE INDEX IF NOT EXISTS idx_merkle_funder ON merkle_signatures(funder_address);

-- Constraint único: Una firma por batch
CREATE UNIQUE INDEX IF NOT EXISTS idx_merkle_unique_batch ON merkle_signatures(batch_id);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_faucets_updated_at ON faucets;
CREATE TRIGGER update_faucets_updated_at
    BEFORE UPDATE ON faucets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_relayers_updated_at ON relayers;
CREATE TRIGGER update_relayers_updated_at
    BEFORE UPDATE ON relayers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_batches_updated_at ON batches;
CREATE TRIGGER update_batches_updated_at
    BEFORE UPDATE ON batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_batch_transactions_updated_at ON batch_transactions;
CREATE TRIGGER update_batch_transactions_updated_at
    BEFORE UPDATE ON batch_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rbac_users_updated_at ON rbac_users;
CREATE TRIGGER update_rbac_users_updated_at
    BEFORE UPDATE ON rbac_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INITIAL DATA (OPTIONAL)
-- ============================================

-- Insertar admin por defecto (opcional)
-- INSERT INTO rbac_users (address, role, name) 
-- VALUES ('0xYourAdminAddress', 'admin', 'Admin User')
-- ON CONFLICT (address) DO NOTHING;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verificar que todas las tablas fueron creadas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Verificar columnas encrypted_key
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND column_name = 'encrypted_key';

-- ============================================
-- NOTAS IMPORTANTES
-- ============================================

/*
1. ENCRYPTION_KEY:
   - Debe estar configurada en variables de entorno
   - Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   - Guardar en múltiples lugares seguros

2. BACKUPS:
   - Railway hace backups automáticos de PostgreSQL
   - Para backup manual: pg_dump $DATABASE_URL > backup.sql
   - Los backups incluyen datos encriptados (necesitas ENCRYPTION_KEY para usarlos)

3. MIGRACIÓN:
   - Si migras desde Vault, ejecutar: DELETE FROM faucets WHERE encrypted_key IS NULL;
   - Esto limpia faucets antiguos sin encriptación

4. PERFORMANCE:
   - El sistema usa cache de 7 minutos para keys desencriptadas
   - No es necesario optimizar queries de encrypted_key

5. SEGURIDAD:
   - Proteger acceso a PostgreSQL
   - Rotar ENCRYPTION_KEY periódicamente
   - Monitorear accesos a la base de datos
*/
