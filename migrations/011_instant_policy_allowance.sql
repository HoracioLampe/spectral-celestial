-- 011: Add allowance column to instant_policies for on-chain sync
-- Stores the live ERC-20 allowance after each reset/activate (synced from blockchain).
ALTER TABLE instant_policies
    ADD COLUMN IF NOT EXISTS allowance NUMERIC(20,6) DEFAULT 0;
