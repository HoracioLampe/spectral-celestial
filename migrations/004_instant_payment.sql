-- Migration 004: Instant Payment Module
-- Run: applied automatically at server startup

-- 1. Instant transfers (idempotency via UUID UNIQUE)
CREATE TABLE IF NOT EXISTS instant_transfers (
  id                SERIAL PRIMARY KEY,
  transfer_id       UUID UNIQUE NOT NULL,
  funder_address    TEXT NOT NULL,
  destination_wallet TEXT NOT NULL,
  amount_usdc       NUMERIC(18,6) NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|processing|confirmed|failed
  tx_hash           TEXT,
  nonce             INT,
  attempt_count     INT DEFAULT 0,
  error_message     TEXT,
  webhook_url       TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_instant_transfers_funder   ON instant_transfers(funder_address);
CREATE INDEX IF NOT EXISTS idx_instant_transfers_status   ON instant_transfers(status);
CREATE INDEX IF NOT EXISTS idx_instant_transfers_created  ON instant_transfers(created_at DESC);

-- 2. Permit policies per cold wallet
CREATE TABLE IF NOT EXISTS instant_policies (
  id                SERIAL PRIMARY KEY,
  cold_wallet       TEXT UNIQUE NOT NULL,
  total_amount      NUMERIC(18,6) NOT NULL,
  consumed_amount   NUMERIC(18,6) NOT NULL DEFAULT 0,
  deadline          TIMESTAMPTZ NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  contract_address  TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Nonce tracking per relayer wallet (for SKIP LOCKED concurrency)
CREATE TABLE IF NOT EXISTS instant_relayer_nonces (
  wallet_address    TEXT PRIMARY KEY,
  current_nonce     INT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Webhook delivery log
CREATE TABLE IF NOT EXISTS instant_webhook_logs (
  id                SERIAL PRIMARY KEY,
  transfer_id       UUID NOT NULL,
  event_type        TEXT NOT NULL, -- transfer.pending|confirmed|failed|idempotent_rejected
  payload           JSONB,
  webhook_url       TEXT,
  delivered         BOOLEAN DEFAULT false,
  attempt_count     INT DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_transfer ON instant_webhook_logs(transfer_id);
