-- Migration 010: Timezone per cold wallet in rbac_users
-- Each cold wallet (funder) can set their preferred display timezone.
-- All timestamps remain stored as UTC in the database.
-- This column is used only for display purposes in the frontend.
-- Applied automatically by initInstantPaymentTables() on server startup.

ALTER TABLE rbac_users
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

COMMENT ON COLUMN rbac_users.timezone IS 'IANA timezone for display purposes only. All database timestamps remain in UTC.';
