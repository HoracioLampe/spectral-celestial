-- Add index to speed up retrieval of relayers with recoverable funds
CREATE INDEX IF NOT EXISTS idx_relayers_last_balance 
ON relayers(last_balance);
