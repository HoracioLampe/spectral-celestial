
const ethers = require('ethers');
const dotenv = require('dotenv');

dotenv.config();

const RPC_URL = process.env.RPC_URL;
const FAUCET_ADDR = "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0";

async function checkHistory() {
    console.log(`🔍 Checking Faucet History: ${FAUCET_ADDR}`);
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    try {
        const count = await provider.getTransactionCount(FAUCET_ADDR);
        console.log(`   Confirmed Nonce: ${count}`);

        // We can't easily list transactions with standard JSON-RPC without an indexer,
        // but we can check if the NEXT nonces are occupied in the txpool if the node supports it.
        // Or we can just check the balance again.

        const balance = await provider.getBalance(FAUCET_ADDR);
        console.log(`   Current Balance: ${ethers.formatEther(balance)} MATIC`);

    } catch (err) {
        console.error("Error:", err.message);
    }
}

checkHistory();
