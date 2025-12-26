const { ethers } = require('ethers');

// Contract details (already deployed on Polygon Mainnet)
const contractAddress = process.env.CONTRACT_ADDRESS || "0x78318c7A0d4E7e403A5008F9DA066A489B65cBad";
const contractABI = [
    "function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external",
    "function processedLeaves(bytes32) view returns (bool)"
];

// Public Polygon Mainnet RPC (no private key needed for callStatic)
const provider = new ethers.JsonRpcProvider("https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/");

(async () => {
    try {
        const contract = new ethers.Contract(contractAddress, contractABI, provider);
        // Dummy parameters – these will likely cause a revert in the real contract, but callStatic will return the revert reason.
        const batchId = 1;
        const txId = 1;
        const funder = "0x0000000000000000000000000000000000000000"; // zero address (invalid, just for simulation)
        const recipient = "0x0000000000000000000000000000000000000000";
        const amount = ethers.parseUnits("0", 6); // 0 USDC
        const proof = [];

        // Use staticCall to simulate the transaction without sending it.
        const result = await contract.executeTransaction.staticCall(batchId, txId, funder, recipient, amount, proof);
        console.log("✅ staticCall succeeded, result:", result);
    } catch (error) {
        // staticCall throws on revert – we capture the revert reason if available.
        console.error("❌ staticCall reverted or failed:", error);
        if (error.error && error.error.message) {
            console.error("Revert reason:", error.error.message);
        }
    }
})();
