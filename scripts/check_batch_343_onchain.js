
const { Pool } = require('pg');
const dotenv = require('dotenv');
const ethers = require('ethers');

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
const RPC_URL = process.env.RPC_URL;

const ABI = [
    "function batchRoots(address funder, uint256 batchId) view returns (bytes32)"
];

async function checkOnChainStatus() {
    console.log("🔍 [On-Chain Check] Verifying Batch 343...");

    try {
        const batchId = 343;
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        const batchRes = await pool.query('SELECT funder_address, merkle_root FROM batches WHERE id = $1', [batchId]);
        if (batchRes.rows.length === 0) {
            console.error("❌ Batch not found in DB.");
            return;
        }

        const { funder_address, merkle_root } = batchRes.rows[0];
        console.log(`\n📦 Batch ID: ${batchId}`);
        console.log(`   Funder: ${funder_address}`);
        console.log(`   Expected Root: ${merkle_root}`);

        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const onChainRoot = await contract.batchRoots(funder_address, batchId);

        console.log(`\n⛓️  On-Chain Status:`);
        console.log(`   Root: ${onChainRoot}`);

        if (onChainRoot === ethers.ZeroHash) {
            console.log("\n❌ Merkle Root NOT registered on-chain.");
            console.log("💡 The background process is likely stuck waiting for the root registration transaction to confirm, or it failed to send it.");
        } else if (onChainRoot.toLowerCase() === merkle_root.toLowerCase()) {
            console.log("\n✅ Merkle Root MATCHES on-chain.");
            console.log("💡 The root is OK. The stall must be in the worker loops or funding validation.");
        } else {
            console.log("\n⚠️ Merkle Root MISMATCH on-chain!");
            console.log(`   Expected: ${merkle_root}`);
            console.log(`   On-Chain: ${onChainRoot}`);
        }

    } catch (err) {
        console.error("❌ On-chain check failed:", err.message);
    } finally {
        await pool.end();
    }
}

checkOnChainStatus();
