import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Check the transfer status and error
const r = await pool.query(`
    SELECT transfer_id, status, attempt_count, error_message, tx_hash, funder_address, destination_wallet, amount_usdc, created_at
    FROM instant_transfers
    ORDER BY created_at DESC
    LIMIT 5
`);
console.table(r.rows);

// Check the policy for this funder
const policy = await pool.query(`
    SELECT cold_wallet, total_amount, consumed_amount, deadline, is_active,
           (deadline < NOW()) as is_expired
    FROM instant_policies
    WHERE cold_wallet = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0'
`);
console.log('\n--- Policy for cold wallet ---');
console.table(policy.rows);

// Check the instant_api_keys
const keys = await pool.query(`
    SELECT cold_wallet, key_prefix, is_active, access_count, last_accessed
    FROM instant_api_keys
    WHERE cold_wallet = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0'
`);
console.log('\n--- API Keys ---');
console.table(keys.rows);

await pool.end();
process.exit(0);
