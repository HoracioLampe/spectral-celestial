import pg from 'pg';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '').trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const COLD_WALLET = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62';
const CONTRACT_ADDRESS = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS || '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const RPC_URL = process.env.RPC_URL_1;

const provider = new ethers.JsonRpcProvider(RPC_URL);

const CONTRACT_ABI = [
    'function getPolicyBalance(address coldWallet) external view returns (uint256 totalAmount, uint256 consumedAmount, uint256 remaining, uint256 deadline, bool isActive, bool isExpired)',
    'function coldWalletRelayer(address coldWallet) external view returns (address)',
];
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

// Policy on-chain
try {
    const [total, consumed, remaining, deadline, isActive, isExpired] =
        await contract.getPolicyBalance(COLD_WALLET);
    console.log('ON-CHAIN POLICY:');
    console.log('  total    :', ethers.formatUnits(total, 6), 'USDC');
    console.log('  consumed :', ethers.formatUnits(consumed, 6), 'USDC');
    console.log('  remaining:', ethers.formatUnits(remaining, 6), 'USDC');
    console.log('  deadline :', new Date(Number(deadline) * 1000).toISOString());
    console.log('  isActive :', isActive);
    console.log('  isExpired:', isExpired);
} catch (e) {
    console.log('Policy ERROR:', e.message);
}

// Relayer
try {
    const relayer = await contract.coldWalletRelayer(COLD_WALLET);
    console.log('\nRELAYER on-chain:', relayer);
} catch (e) {
    console.log('Relayer ERROR:', e.message);
}

// DB transfers
const { rows } = await pool.query(`
    SELECT transfer_id, status, amount_usdc, attempt_count, error_message, created_at
    FROM instant_transfers
    WHERE LOWER(funder_address) = LOWER($1)
    ORDER BY created_at DESC LIMIT 5
`, [COLD_WALLET]);

console.log('\nDB TRANSFERS:');
for (const r of rows) {
    console.log(`  [${r.status}] ${r.transfer_id} | ${r.amount_usdc} USDC | attempts=${r.attempt_count}`);
    if (r.error_message) console.log('    ERROR:', r.error_message.substring(0, 120));
}

await pool.end();
