import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const COLD_WALLET = '0x9795e3a0d7824c651adf3880f976ebfdb0121e62';

const faucets = await pool.query(
    'SELECT id, address, funder_address FROM faucets WHERE LOWER(funder_address) = $1',
    [COLD_WALLET]
);

console.log('Faucets in DB for', COLD_WALLET);
console.table(faucets.rows);
console.log('Expected faucet address:', faucets.rows[0]?.address || 'NONE');
console.log('On-chain registered relayer: 0x9675B588a14B986bA98f0f28785Fe9d4F83EAc8e');
const match = faucets.rows[0]?.address?.toLowerCase() === '0x9675b588a14b986ba98f0f28785fe9d4f83eac8e';
console.log('Match:', match);
if (!match) console.log('⚠️ MISMATCH — el frontend pide nueva firma de relayer porque no coinciden');

await pool.end();
process.exit(0);
