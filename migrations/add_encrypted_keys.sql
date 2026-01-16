-- Migration: Add encrypted_key columns to faucets and relayers
-- Run this in Railway PostgreSQL console

-- Add encrypted_key to faucets table
ALTER TABLE faucets 
ADD COLUMN IF NOT EXISTS encrypted_key TEXT;

-- Add encrypted_key to relayers table  
ALTER TABLE relayers
ADD COLUMN IF NOT EXISTS encrypted_key TEXT;

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('faucets', 'relayers') 
  AND column_name = 'encrypted_key';
