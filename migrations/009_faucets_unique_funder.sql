-- Migration: add UNIQUE constraint to faucets.funder_address
-- This is required for the ON CONFLICT (funder_address) clause in services/faucet.js
-- Safe to run: 0 duplicate funder_address values confirmed in production

ALTER TABLE faucets
    ADD CONSTRAINT faucets_funder_address_unique UNIQUE (funder_address);
