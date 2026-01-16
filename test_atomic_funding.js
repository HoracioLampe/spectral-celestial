const { ethers } = require('ethers');

// CONFIG
const CONTRACT_ADDRESS = "0x78318c7A0d4E7e403A5008F9DA066A489B65cBad";
const RPC_URL = "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Human-Readable ABI as used in relayerEngine.js
const ABI = [
    "function distributeMatic(address[] calldata recipients, uint256 amount) external payable"
];

async function testAtomic() {
    console.log("🧪 Testing Atomic Funding (distributeMatic)...");

    // Create a random wallet for testing (simulation only - we'll use staticCall)
    const wallet = ethers.Wallet.createRandom().connect(provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const recipients = [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002"
    ];
    const amountPerRelayer = ethers.parseEther("0.01");
    const totalValue = amountPerRelayer * BigInt(recipients.length);

    console.log(`📊 Params: ${recipients.length} recipients, ${ethers.formatEther(amountPerRelayer)} MATIC each.`);
    console.log(`💰 Total Value: ${ethers.formatEther(totalValue)} MATIC`);

    try {
        console.log("🔄 Calling staticCall...");
        // This will simulate the call including the value sending
        await contract.distributeMatic.staticCall(recipients, amountPerRelayer, { value: totalValue });
        console.log("✅ Simulation SUCCESS! The function and ABI are correct.");
    } catch (e) {
        console.error("❌ Simulation FAILED.");
        console.error("Error Message:", e.message);
        if (e.data) console.error("Error Data:", e.data);
    }
}

testAtomic();
