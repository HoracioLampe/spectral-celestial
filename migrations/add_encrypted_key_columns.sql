-- ============================================
-- MIGRATION: Add encrypted_key columns
-- ============================================
-- Este script agrega las columnas encrypted_key a las tablas faucets y relayers
-- para soportar el almacenamiento encriptado de claves privadas

-- 1. Agregar columna encrypted_key a tabla faucets
ALTER TABLE faucets 
ADD COLUMN IF NOT EXISTS encrypted_key TEXT;

-- 2. Agregar columna encrypted_key a tabla relayers
ALTER TABLE relayers 
ADD COLUMN IF NOT EXISTS encrypted_key TEXT;

-- 3. Verificar las columnas agregadas
SELECT 
    'faucets' as table_name,
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'faucets'
  AND column_name IN ('encrypted_key', 'private_key', 'address')
ORDER BY ordinal_position;

SELECT 
    'relayers' as table_name,
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name = 'relayers'
  AND column_name IN ('encrypted_key', 'private_key', 'address')
ORDER BY ordinal_position;

-- 4. Contar registros actuales
SELECT 
    'faucets' as table_name,
    COUNT(*) as total_records,
    COUNT(encrypted_key) as with_encrypted_key,
    COUNT(*) - COUNT(encrypted_key) as without_encrypted_key
FROM faucets;

SELECT 
    'relayers' as table_name,
    COUNT(*) as total_records,
    COUNT(encrypted_key) as with_encrypted_key,
    COUNT(*) - COUNT(encrypted_key) as without_encrypted_key
FROM relayers;

-- ============================================
-- NOTAS:
-- ============================================
-- - Las columnas encrypted_key almacenarán las claves privadas encriptadas con AES-256-GCM
-- - La ENCRYPTION_KEY del .env se usa para encriptar/desencriptar
-- - Las columnas private_key (legacy) pueden mantenerse temporalmente para migración
-- - Una vez migradas todas las claves, se puede eliminar la columna private_key
