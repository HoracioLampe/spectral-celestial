-- Script para actualizar valores aleatorios de amount_usdc y amount_sent
-- en batch_transactions para batch_id = 519
-- IMPORTANTE: Este script NO se ha ejecutado automáticamente
-- Revisa los valores antes de ejecutar

-- Actualizar amount_usdc y amount_sent con valores aleatorios entre 1,000,000 y 200,000,000
UPDATE batch_transactions
SET 
    amount_usdc = floor(random() * (200000000 - 1000000 + 1) + 1000000)::bigint,
    amount_sent = floor(random() * (200000000 - 1000000 + 1) + 1000000)::bigint
WHERE batch_id = 519;

-- Para verificar los cambios después de ejecutar:
-- SELECT id, wallet_address_to, amount_usdc, amount_sent 
-- FROM batch_transactions 
-- WHERE batch_id = 519 
-- ORDER BY id;
