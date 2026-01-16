
const { ethers } = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function auditAll() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    try {
        const res = await pool.query("SELECT address, private_key, batch_id FROM relayers WHERE last_balance != '0' OR last_activity > NOW() - INTERVAL '1 DAY'");
        console.log(`📋 GLOBAL NONCE AUDIT (${res.rows.length} relayers)`);
        console.log(`------------------------------------------------------------------------------------`);
        console.log(`| BATCH | ADDRESS                                    | LATEST | PEND | BALANCE  | STATUS |`);
        console.log(`------------------------------------------------------------------------------------`);

        for (let r of res.rows) {
            const addr = r.address;
            try {
                const latest = await provider.getTransactionCount(addr, "latest");
                const pending = await provider.getTransactionCount(addr, "pending");
                const bal = await provider.getBalance(addr);
                const diff = pending - latest;
                const status = diff > 0 ? "⚠️ BLOCKED" : "✅ OK";
                const balStr = ethers.formatEther(bal).slice(0, 8);

                if (parseFloat(balStr) > 0 || diff > 0) {
                    console.log(`| ${r.batch_id.toString().padEnd(5)} | ${addr} | ${latest.toString().padEnd(6)} | ${pending.toString().padEnd(4)} | ${balStr.padEnd(8)} | ${status} |`);
                }
            } catch (e) { }
        }
        console.log(`------------------------------------------------------------------------------------`);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

auditAll();
