import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const result = await pool.query(`
    SELECT transfer_id, funder_address, destination_wallet, amount_usdc, 
           status, attempt_count, tx_hash, error_message, created_at, confirmed_at
    FROM instant_transfers 
    ORDER BY created_at DESC 
    LIMIT 4
`);

result.rows.forEach(r => {
    console.log(`\nID: ${r.transfer_id}`);
    console.log(`  status: ${r.status} | attempts: ${r.attempt_count}`);
    console.log(`  amount: ${r.amount_usdc} USDC`);
    console.log(`  tx_hash: ${r.tx_hash || 'none'}`);
    console.log(`  confirmed_at: ${r.confirmed_at || 'not yet'}`);
    console.log(`  error: ${r.error_message?.slice(0, 80) || 'none'}`);
});

await pool.end();
process.exit(0);
