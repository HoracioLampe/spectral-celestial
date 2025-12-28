require('dotenv').config();
const { ethers } = require('ethers');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x78318c7A0d4E7e403A5008F9DA066A489B65cBad";
const RPC_URL = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function diagnose() {
    try {
        console.log("🔍 Diagnosing Relayer Funding...");

        // 1. Check Faucet
        const faucetRes = await pool.query('SELECT address, private_key FROM faucets ORDER BY id DESC LIMIT 1');
        if (faucetRes.rows.length === 0) {
            console.error("❌ No faucet found in DB.");
            return;
        }
        const faucet = faucetRes.rows[0];
        const bal = await provider.getBalance(faucet.address);
        console.log(`🏦 Faucet: ${faucet.address} | Balance: ${ethers.formatEther(bal)} MATIC`);

        // 2. Check latest batch
        const batchRes = await pool.query('SELECT id, total_transactions, status FROM batches ORDER BY id DESC LIMIT 1');
        if (batchRes.rows.length === 0) {
            console.log("ℹ️ No batches found.");
        } else {
            const batch = batchRes.rows[0];
            console.log(`📦 Latest Batch: #${batch.id} | Status: ${batch.status} | Txs: ${batch.total_transactions}`);

            // Calculate hypothetical cost (using the logic in RelayerEngine)
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice || 35000000000n;
            const avgGasPerTx = 200000n; // fallback used in code
            const buffer = 150n; // 150%

            const totalGas = BigInt(batch.total_transactions) * avgGasPerTx * buffer / 100n;
            const totalCost = totalGas * gasPrice;

            console.log(`⛽ Estimated Total Cost for this batch: ${ethers.formatEther(totalCost)} MATIC (at ${ethers.formatUnits(gasPrice, 'gwei')} gwei)`);

            if (bal < totalCost) {
                console.error("⚠️ INSUFFICIENT FUNDS: Faucet cannot cover the estimated cost.");
            } else {
                console.log("✅ Faucet has enough funds for conservative estimate.");
            }
        }

        // 3. Test Contract distributeMatic call (staticCall)
        const abi = ["function distributeMatic(address[] calldata recipients, uint256 amount) external payable"];
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
        const faucetWallet = new ethers.Wallet(faucet.private_key, provider);

        try {
            console.log("🧪 Testing distributeMatic simulation...");
            await contract.connect(faucetWallet).distributeMatic.staticCall(
                [ethers.ZeroAddress],
                ethers.parseEther("0.0001"),
                { value: ethers.parseEther("0.0001") }
            );
            console.log("✅ Simulation SUCCESSful.");
        } catch (e) {
            console.error("❌ Simulation FAILED:", e.message);
        }

    } catch (err) {
        console.error("💥 Critical Diagnostic Error:", err);
    } finally {
        await pool.end();
    }
}

diagnose();
