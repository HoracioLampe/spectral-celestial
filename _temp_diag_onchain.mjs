import { ethers } from 'ethers';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const CONTRACT_ADDRESS = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;
const COLD_WALLET = '0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0';

// Pick first working RPC
const rpcKeys = Object.keys(process.env).filter(k => k.startsWith('RPC_URL') || k.startsWith('POLYGON_RPC'));
const RPC_URL = process.env[rpcKeys[0]];
const provider = new ethers.JsonRpcProvider(RPC_URL);

const ABI = [
    'function coldWalletRelayer(address coldWallet) external view returns (address)',
    'function getPolicyBalance(address coldWallet) external view returns (uint256 totalAmount, uint256 consumedAmount, uint256 remaining, uint256 deadline, bool isActive, bool isExpired)',
];
const USDC_ABI = [
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
];
const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);

console.log('CONTRACT:', CONTRACT_ADDRESS);
console.log('COLD_WALLET:', COLD_WALLET);

// 1. Relayer registered on-chain?
console.log('\n--- 1. Relayer on-chain ---');
const relayer = await contract.coldWalletRelayer(COLD_WALLET);
console.log('coldWalletRelayer:', relayer);
console.log('Is zero address:', relayer === ethers.ZeroAddress);

// Faucet from DB
const faucetRes = await pool.query('SELECT address FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [COLD_WALLET]);
const faucet = faucetRes.rows[0]?.address;
console.log('Expected faucet (from DB):', faucet);
console.log('Relayer matches faucet:', relayer?.toLowerCase() === faucet?.toLowerCase());

// 2. Policy on-chain
console.log('\n--- 2. Policy on-chain ---');
const [totalAmount, consumed, remaining, deadline, isActive, isExpired] = await contract.getPolicyBalance(COLD_WALLET);
console.log('totalAmount:', ethers.formatUnits(totalAmount, 6), 'USDC');
console.log('remaining  :', ethers.formatUnits(remaining, 6), 'USDC');
console.log('deadline   :', new Date(Number(deadline) * 1000).toISOString());
console.log('isActive   :', isActive);
console.log('isExpired  :', isExpired);

// 3. USDC allowance from cold wallet to contract
console.log('\n--- 3. USDC Allowance cold_wallet → contract ---');
const allowance = await usdc.allowance(COLD_WALLET, CONTRACT_ADDRESS);
const balance = await usdc.balanceOf(COLD_WALLET);
console.log('allowance:', ethers.formatUnits(allowance, 6), 'USDC');
console.log('balance  :', ethers.formatUnits(balance, 6), 'USDC');

await pool.end();
process.exit(0);
