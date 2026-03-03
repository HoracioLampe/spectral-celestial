import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '').trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Últimos transfers instantáneos
const { rows: transfers } = await pool.query(`
    SELECT transfer_id, funder_address, destination_wallet, amount_usdc,
           status, attempt_count, tx_hash, error_message,
           created_at, updated_at, confirmed_at
    FROM instant_transfers
    ORDER BY created_at DESC
    LIMIT 10
`);
console.log('\n=== ÚLTIMOS INSTANT TRANSFERS ===');
console.table(transfers.map(r => ({
    id: r.transfer_id.substring(0, 18) + '...',
    status: r.status,
    amount: r.amount_usdc,
    attempts: r.attempt_count,
    tx_hash: r.tx_hash ? r.tx_hash.substring(0, 12) + '...' : null,
    error: r.error_message?.substring(0, 50),
    created: r.created_at?.toISOString().substring(11, 19),
    updated: r.updated_at?.toISOString().substring(11, 19),
})));

// Política activa
const { rows: policies } = await pool.query(`
    SELECT cold_wallet, total_amount, consumed_amount, deadline, is_active
    FROM instant_policies
    WHERE is_active = true
    ORDER BY updated_at DESC
    LIMIT 5
`);
console.log('\n=== POLÍTICAS ACTIVAS ===');
console.table(policies.map(p => ({
    wallet: p.cold_wallet.substring(0, 10) + '...',
    total: p.total_amount,
    consumed: p.consumed_amount,
    remaining: (parseFloat(p.total_amount) - parseFloat(p.consumed_amount)).toFixed(2),
    deadline: new Date(p.deadline).toISOString().substring(0, 19),
    active: p.is_active
})));

await pool.end();
process.exit(0);
