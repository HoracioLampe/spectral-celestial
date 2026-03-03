-- Migration 007: PostgreSQL LISTEN/NOTIFY para instant_transfers
-- Trigger que emite pg_notify en cada INSERT o UPDATE de instant_transfers
-- El servidor Node.js escucha el canal y reenvía el payload por SSE al browser

SET client_encoding = 'UTF8';

BEGIN;

-- Función que construye el payload JSON y lo notifica
CREATE OR REPLACE FUNCTION notify_instant_transfer_change()
RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'instant_transfers_changed',
        json_build_object(
            'transfer_id',       NEW.transfer_id,
            'funder_address',    NEW.funder_address,
            'destination_wallet',NEW.destination_wallet,
            'amount_usdc',       NEW.amount_usdc,
            'status',            NEW.status,
            'tx_hash',           NEW.tx_hash,
            'attempt_count',     NEW.attempt_count,
            'created_at',        NEW.created_at,
            'confirmed_at',      NEW.confirmed_at,
            'error_message',     NEW.error_message
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger AFTER INSERT OR UPDATE (FOR EACH ROW)
DROP TRIGGER IF EXISTS instant_transfer_notify_trigger ON instant_transfers;

CREATE TRIGGER instant_transfer_notify_trigger
AFTER INSERT OR UPDATE ON instant_transfers
FOR EACH ROW
EXECUTE FUNCTION notify_instant_transfer_change();

COMMIT;
