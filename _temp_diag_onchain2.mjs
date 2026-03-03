import pg from 'pg';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '').trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const COLD_WALLET = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62';
const CONTRACT_ADDRESS = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS || '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const RPC_URL = process.env.RPC_URL_1;

const provider = new ethers.JsonRpcProvider(RPC_URL);

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
];
const CONTRACT_ABI = [
    'function getPolicyBalance(address coldWallet) external view returns (uint256 totalAmount, uint256 consumedAmount, uint256 remaining, uint256 deadline, bool isActive, bool isExpired)',
    'function coldWalletRelayer(address coldWallet) external view returns (address)',
];

const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

console.log('\n=== DIAGNÓSTICO ON-CHAIN ===');
console.log('Cold Wallet :', COLD_WALLET);
console.log('Contract    :', CONTRACT_ADDRESS);
console.log('USDC        :', USDC_ADDRESS);

// 1. USDC Balance
const balance = await usdc.balanceOf(COLD_WALLET);
console.log('\n[USDC Balance]', ethers.formatUnits(balance, 6), 'USDC');

// 2. USDC Allowance al contrato
const allowance = await usdc.allowance(COLD_WALLET, CONTRACT_ADDRESS);
console.log('[USDC Allowance → Contrato]', ethers.formatUnits(allowance, 6), 'USDC');

// 3. Policy on-chain
try {
    const [total, consumed, remaining, deadline, isActive, isExpired] =
        await contract.getPolicyBalance(COLD_WALLET);
    console.log('\n[Policy On-Chain]');
    console.log('  total    :', ethers.formatUnits(total, 6), 'USDC');
    console.log('  consumed :', ethers.formatUnits(consumed, 6), 'USDC');
    console.log('  remaining:', ethers.formatUnits(remaining, 6), 'USDC');
    console.log('  deadline :', new Date(Number(deadline) * 1000).toISOString());
    console.log('  isActive :', isActive);
    console.log('  isExpired:', isExpired);
} catch (e) {
    console.log('[Policy On-Chain] ERROR:', e.message);
}

// 4. Relayer registrado
try {
    const relayer = await contract.coldWalletRelayer(COLD_WALLET);
    console.log('\n[Relayer registrado]', relayer);
} catch (e) {
    console.log('[Relayer] ERROR:', e.message);
}

// 5. DB State
const { rows: transfers } = await pool.query(`
    SELECT transfer_id, status, amount_usdc, attempt_count, error_message, created_at
    FROM instant_transfers
    WHERE LOWER(funder_address) = LOWER($1)
    ORDER BY created_at DESC LIMIT 5
`, [COLD_WALLET]);
console.log('\n[DB - Últimos Transfers]');
console.table(transfers.map(r => ({
    id: r.transfer_id.substring(0, 22),
    status: r.status,
    amount: r.amount_usdc,
    attempts: r.attempt_count,
    error: r.error_message?.substring(0, 60),
})));

const { rows: policies } = await pool.query(`
    SELECT total_amount, consumed_amount, deadline, is_active
    FROM instant_policies WHERE LOWER(cold_wallet) = LOWER($1)
`, [COLD_WALLET]);
console.log('\n[DB - Policy]');
console.table(policies);

await pool.end();
process.exit(0);
