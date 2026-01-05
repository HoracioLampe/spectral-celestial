require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = process.env.RPC_URL;
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function audit() {
    try {
        console.log("🔍 Auditing Relayer Balances and Nonces (Last 5 Batches)...");

        const res = await pool.query(`
            SELECT r.address, r.private_key, r.batch_id, r.status
            FROM relayers r
            WHERE r.batch_id IN (
                SELECT id FROM batches ORDER BY id DESC LIMIT 5
            )
            ORDER BY r.batch_id DESC, r.id ASC
        `);

        const relayers = res.rows;
        console.log(`📊 Found ${relayers.length} relayers to check.\n`);

        console.log("ID    | Batch | Address                                | Balance (MATIC) | Nonce (L/P) | Status");
        console.log("--------------------------------------------------------------------------------------------------");

        for (const r of relayers) {
            try {
                const bal = await provider.getBalance(r.address);
                const latest = await provider.getTransactionCount(r.address, 'latest');
                const pending = await provider.getTransactionCount(r.address, 'pending');

                const balStr = ethers.formatEther(bal).substring(0, 10).padEnd(15);
                const nonceStr = `${latest}/${pending}`.padEnd(11);
                const statusStr = (r.status || 'active').padEnd(10);
                const batchStr = String(r.batch_id).padEnd(5);

                if (bal > 0n || pending > latest) {
                    const alert = (pending > latest) ? "⚠️ STUCK" : (bal > ethers.parseEther("0.1") ? "💰 FUNDED" : "");
                    console.log(`${batchStr} | ${r.address} | ${balStr} | ${nonceStr} | ${statusStr} ${alert}`);
                }
            } catch (e) {
                console.log(`${r.batch_id} | ${r.address} | ERROR: ${e.message.substring(0, 30)}`);
            }
        }

    } catch (err) {
        console.error("Fatal Error:", err);
    } finally {
        await pool.end();
    }
}

audit();
