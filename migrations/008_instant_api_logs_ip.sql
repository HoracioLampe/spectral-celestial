-- Migration 008: Add client_ip and request_headers to instant_api_logs
ALTER TABLE instant_api_logs ADD COLUMN IF NOT EXISTS client_ip      VARCHAR(64);
ALTER TABLE instant_api_logs ADD COLUMN IF NOT EXISTS request_headers JSONB;
