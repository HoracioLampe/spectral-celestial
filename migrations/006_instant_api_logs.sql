-- Migration 006: Instant Payment API Logs
-- Unified log table for API requests and webhook deliveries
SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE IF NOT EXISTS instant_api_logs (
    id              BIGSERIAL PRIMARY KEY,
    log_type        VARCHAR(20) NOT NULL,   -- 'api_request' | 'webhook_sent'
    cold_wallet     TEXT,
    transfer_id     TEXT,
    event_type      TEXT,                   -- 'transfer.received' | 'transfer.confirmed' etc.
    request_body    JSONB,
    response_body   JSONB,
    webhook_url     TEXT,
    webhook_payload JSONB,
    http_status     INT,
    delivered       BOOLEAN,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_logs_wallet   ON instant_api_logs(cold_wallet);
CREATE INDEX IF NOT EXISTS idx_api_logs_transfer ON instant_api_logs(transfer_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created  ON instant_api_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_type     ON instant_api_logs(log_type);

COMMIT;
