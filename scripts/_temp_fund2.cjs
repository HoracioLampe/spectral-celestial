// _temp_fund2.cjs — envía 2 MATIC al deployer desde la faucet
require('dotenv').config();
const { ethers } = require('ethers');
const { Pool } = require('pg');
const encryption = require('../services/encryption');

const DEPLOYER = '0x8719CD06973A282DC8abBfA6936aAD27Fea6bc81';
const FAUCET_ADDR = '0x9675B588a14B986bA98f0f28785Fe9d4F83EAc8e';

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    const res = await pool.query('SELECT encrypted_key FROM faucets WHERE LOWER(address)=LOWER($1) LIMIT 1', [FAUCET_ADDR]);
    await pool.end();

    const faucetPk = encryption.decrypt(res.rows[0].encrypted_key);
    const faucet = new ethers.Wallet(faucetPk.trim(), provider);

    console.log('Faucet balance:', ethers.formatEther(await provider.getBalance(faucet.address)), 'MATIC');
    console.log('Deployer balance:', ethers.formatEther(await provider.getBalance(DEPLOYER)), 'MATIC');

    const tx = await faucet.sendTransaction({ to: DEPLOYER, value: ethers.parseEther('2'), gasLimit: 21000 });
    console.log('TX:', tx.hash);
    await tx.wait(2);
    console.log('✅ Nuevo balance deployer:', ethers.formatEther(await provider.getBalance(DEPLOYER)), 'MATIC');
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
