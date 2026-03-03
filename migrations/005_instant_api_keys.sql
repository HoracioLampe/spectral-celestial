-- Migration 005: Instant Payment API Keys (B2B Multitenant Auth)
-- Applied automatically by initInstantPaymentTables() on server startup
-- Encoding: UTF-8
SET client_encoding = 'UTF8';

BEGIN;

-- Add updated_at to instant_transfers (used by InstantRelayerEngine for processing tracking)
ALTER TABLE instant_transfers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS instant_api_keys (
  id            SERIAL PRIMARY KEY,
  cold_wallet   TEXT UNIQUE NOT NULL,           -- 1 key per cold wallet (multitenant)
  key_hash      TEXT UNIQUE NOT NULL,            -- SHA-256(api_key), never store plaintext
  key_prefix    VARCHAR(16) NOT NULL,            -- e.g. "sk_live_a3b4c5d6" for visual ID
  is_active     BOOLEAN DEFAULT true,
  access_count  BIGINT DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON instant_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_wallet ON instant_api_keys(cold_wallet);

-- Default webhook URL per user/tenant (stored in rbac_users — the tenant profile table)
-- Used as fallback when POST /transfer doesn't include webhook_url in body
ALTER TABLE rbac_users ADD COLUMN IF NOT EXISTS webhook_default_url TEXT;

COMMIT;

