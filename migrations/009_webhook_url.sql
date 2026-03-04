-- Migration 009: Webhook URL + per-wallet HMAC secret in rbac_users
-- One URL per cold wallet; used as fallback when POST /transfer omits webhook_url.
-- webhook_secret_enc stores AES-256-GCM encrypted secret (same pattern as faucet keys).

ALTER TABLE rbac_users
  ADD COLUMN IF NOT EXISTS webhook_default_url TEXT;

ALTER TABLE rbac_users
  ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT;

ALTER TABLE rbac_users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
