
const { ethers } = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkNonces() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    try {
        const res = await pool.query("SELECT address FROM relayers WHERE batch_id = 170");
        console.log(`📋 REPORTE DE NONCES (Relayers Batch 170)`);
        console.log(`------------------------------------------------------------------------------------`);
        console.log(`| #  | ADDRESS                                    | LATEST | PEND | BALANCE  | STATUS |`);
        console.log(`------------------------------------------------------------------------------------`);

        for (let i = 0; i < res.rows.length; i++) {
            const addr = res.rows[i].address;
            const latest = await provider.getTransactionCount(addr, "latest");
            const pending = await provider.getTransactionCount(addr, "pending");
            const bal = await provider.getBalance(addr);
            const diff = pending - latest;
            const status = diff > 0 ? "⚠️ BLOCKED" : "✅ OK";
            const balStr = ethers.formatEther(bal).slice(0, 8);

            console.log(`| ${(i + 1).toString().padEnd(2)} | ${addr} | ${latest.toString().padEnd(6)} | ${pending.toString().padEnd(4)} | ${balStr.padEnd(8)} | ${status} |`);
        }
        console.log(`------------------------------------------------------------------------------------`);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkNonces();
