require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function checkAllowance() {
    try {
        const funderAddress = '0x05dac55cc6fd7b84be32fd262ce4521eb6b29c38'; // From error log
        const contractAddress = '0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5';
        const usdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC Polygon

        const provider = new ethers.JsonRpcProvider(RPC_URL);

        const usdcAbi = [
            'function allowance(address owner, address spender) view returns (uint256)',
            'function balanceOf(address account) view returns (uint256)'
        ];

        const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);

        console.log('\n🔍 Verificando Allowance y Balance USDC\n');
        console.log(`Funder: ${funderAddress}`);
        console.log(`Contract: ${contractAddress}\n`);

        const allowance = await usdc.allowance(funderAddress, contractAddress);
        const balance = await usdc.balanceOf(funderAddress);

        console.log(`💰 Balance USDC: ${ethers.formatUnits(balance, 6)} USDC`);
        console.log(`✅ Allowance: ${ethers.formatUnits(allowance, 6)} USDC`);

        if (allowance === 0n) {
            console.log('\n⚠️  PROBLEMA: Allowance es 0!');
            console.log('El funder debe aprobar el contrato para gastar USDC.');
            console.log('\nSolución:');
            console.log('1. Conectar wallet del funder en la UI');
            console.log('2. Hacer clic en "Aprobar USDC"');
            console.log('3. Confirmar la transacción de aprobación\n');
        } else {
            console.log('\n✅ Allowance configurado correctamente\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkAllowance();
