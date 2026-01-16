
const ethers = require('ethers');
const dotenv = require('dotenv');

dotenv.config();

const RPC_URL = process.env.RPC_URL;
const FAUCET_ADDR = "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0";

async function checkFaucet() {
    console.log(`🔍 Checking Faucet: ${FAUCET_ADDR}`);
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    try {
        const balance = await provider.getBalance(FAUCET_ADDR);
        const count = await provider.getTransactionCount(FAUCET_ADDR);
        const pendingCount = await provider.getTransactionCount(FAUCET_ADDR, "pending");

        console.log(`   Balance: ${ethers.formatEther(balance)} MATIC`);
        console.log(`   Confirmed Nonce: ${count}`);
        console.log(`   Pending Nonce:   ${pendingCount}`);

        if (pendingCount > count) {
            console.log(`\n⚠️  [STUCK] Faucet has ${pendingCount - count} pending transaction(s).`);
        } else {
            console.log(`\n✅ Faucet queue is empty (on node).`);
        }
    } catch (err) {
        console.error("Error:", err.message);
    }
}

checkFaucet();
