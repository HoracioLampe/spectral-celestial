
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Configure Provider
// Priority: QUICKNODE_URL -> PROVIDER_URL -> Fallback
const RPC_URL = process.env.QUICKNODE_URL || process.env.PROVIDER_URL || "https://polygon-rpc.com";
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function checkBalances() {
    console.log(`🔍 Faucet Auditor v1.0`);
    console.log(`🔌 Connected to RPC: ${RPC_URL}`);
    console.log(`---------------------------------------------------------------`);

    try {
        // 1. Get all faucets
        const res = await pool.query('SELECT address, funder_address FROM faucets ORDER BY id ASC');
        console.log(`Found ${res.rows.length} faucets in database.`);
        console.log(`---------------------------------------------------------------`);
        console.log(`| ID  | Address                                    | Funder (Owner)                           | Balance (POL) |`);
        console.log(`|-----|--------------------------------------------|------------------------------------------|---------------|`);

        let totalBalance = 0n;

        // 2. Iterate and check balance (Parallel for speed, but limit batch size if too many)
        // For < 50 items, Promise.all is fine.
        const checks = res.rows.map(async (row, index) => {
            try {
                const balanceWei = await provider.getBalance(row.address);
                totalBalance += balanceWei;
                const balanceEth = parseFloat(ethers.formatEther(balanceWei)).toFixed(4);

                // Highlight non-zero balances
                const balanceDisplay = balanceWei > 0n ? `💰 ${balanceEth}` : `   ${balanceEth}`;

                return {
                    id: index + 1,
                    address: row.address,
                    funder: row.funder_address || "System/Unknown",
                    balanceRaw: balanceWei,
                    balanceDisplay: balanceDisplay
                };
            } catch (err) {
                return {
                    id: index + 1,
                    address: row.address,
                    funder: row.funder_address,
                    balanceRaw: 0n,
                    balanceDisplay: "❌ ERROR"
                };
            }
        });

        const results = await Promise.all(checks);

        results.forEach(r => {
            console.log(`| ${r.id.toString().padEnd(3)} | ${r.address} | ${r.funder.padEnd(40)} | ${r.balanceDisplay.padEnd(13)} |`);
        });

        console.log(`---------------------------------------------------------------`);
        console.log(`💰 TOTAL SYSTEM LIQUIDITY: ${ethers.formatEther(totalBalance)} POL`);

    } catch (err) {
        console.error("❌ Fatal Error:", err.message);
    } finally {
        await pool.end();
    }
}

checkBalances();
