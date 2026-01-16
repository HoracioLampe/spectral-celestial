
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const RPC_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const CONTRACT_ADDRESS = "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const ABI = [
    "function batchRoots(address funder, uint256 batchId) view returns (bytes32)",
    "function batchPaused(address funder, uint256 batchId) view returns (bool)",
    "function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external",
    "function processedLeaves(bytes32) view returns (bool)"
];

const USDC_ABI = [
    "function balanceO f(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)"
];

async function diagnose() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const batchId = 167;

    try {
        console.log(`🔎 DIAGNOSING BATCH ${batchId}...`);

        // 1. Get Batch Info
        const batchRes = await pool.query('SELECT funder_address, merkle_root FROM batches WHERE id = $1', [batchId]);
        const { funder_address, merkle_root } = batchRes.rows[0];
        console.log(`👤 Funder: ${funder_address}`);
        console.log(`🌳 DB Root: ${merkle_root}`);

        // 2. Check Contract State
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const onChainRoot = await contract.batchRoots(funder_address, batchId);
        const isPaused = await contract.batchPaused(funder_address, batchId);

        console.log(`🔗 On-Chain Root: ${onChainRoot}`);
        console.log(`⏸️ Is Paused: ${isPaused}`);

        if (onChainRoot === ethers.ZeroHash) {
            console.error("❌ ERROR: Merkle Root is NOT set on-chain for this funder/batch!");
        } else if (onChainRoot !== merkle_root) {
            console.error(`❌ ERROR: Root Mismatch! DB says ${merkle_root}, Chain says ${onChainRoot}`);
        }

        // 3. Check USDC
        const usdc = new ethers.Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)", "function allowance(address, address) view returns (uint256)"], provider);
        const balance = await usdc.balanceOf(funder_address);
        const allowance = await usdc.allowance(funder_address, CONTRACT_ADDRESS);

        console.log(`💰 Funder Balance:   ${ethers.formatUnits(balance, 6)} USDC`);
        console.log(`🛡️ Funder Allowance: ${ethers.formatUnits(allowance, 6)} USDC`);

        // 4. Try simulating ONE failed tx
        const txRes = await pool.query('SELECT * FROM batch_transactions WHERE batch_id = $1 AND status = \'PENDING\' LIMIT 1', [batchId]);
        if (txRes.rows.length > 0) {
            const tx = txRes.rows[0];
            console.log(`🧪 Simulating Tx ${tx.id} to ${tx.wallet_address_to} for ${tx.amount_usdc} raw...`);

            // Get proof
            const RelayerEngine = require('../services/relayerEngine');
            const engine = new RelayerEngine(pool, RPC_URL, "0x0123456789012345678901234567890123456789012345678901234567890123");
            const proof = await engine.getMerkleProof(batchId, tx.id);
            console.log(`📜 Proof:`, proof);

            try {
                // Use a random wallet for simulation (caller doesn't matter for simulation usually if it's not restricted)
                const simWallet = ethers.Wallet.createRandom().connect(provider);
                const simContract = contract.connect(simWallet);
                await simContract.executeTransaction.estimateGas(
                    batchId, tx.id, funder_address, tx.wallet_address_to, BigInt(tx.amount_usdc), proof
                );
                console.log("✅ Simulation SUCCEEDED!");
            } catch (simErr) {
                console.error("❌ Simulation FAILED:", simErr.message);
                if (simErr.data) {
                    console.log("   Data:", simErr.data);
                }
            }
        }

    } catch (err) {
        console.error("❌ Diagnosis Failed:", err);
    } finally {
        await pool.end();
    }
}

diagnose();
