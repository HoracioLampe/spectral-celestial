-- Script para limpiar faucets y relayers viejos (sin encrypted_key)
-- Ejecutar en Railway PostgreSQL Console

-- 1. Ver cuántos faucets/relayers hay sin encrypted_key
SELECT 'faucets sin encrypted_key' as tipo, COUNT(*) as cantidad 
FROM faucets WHERE encrypted_key IS NULL
UNION ALL
SELECT 'relayers sin encrypted_key' as tipo, COUNT(*) as cantidad 
FROM relayers WHERE encrypted_key IS NULL;

-- 2. BORRAR faucets viejos (sin encrypted_key)
DELETE FROM faucets WHERE encrypted_key IS NULL;

-- 3. BORRAR relayers viejos (sin encrypted_key)
DELETE FROM relayers WHERE encrypted_key IS NULL;

-- 4. Verificar que quedaron limpios
SELECT 'faucets totales' as tipo, COUNT(*) as cantidad FROM faucets
UNION ALL
SELECT 'relayers totales' as tipo, COUNT(*) as cantidad FROM relayers;
