const { ethers } = require('ethers');

// Contract details (already deployed on Polygon Mainnet)
const contractAddress = "0x1B9005DBb8f5EB197EaB6E2CB6555796e94663Af";
const contractABI = [
    "function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external",
    "function processedLeaves(bytes32) view returns (bool)"
];

// Public Polygon Mainnet RPC (no private key needed for callStatic)
const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");

(async () => {
    try {
        const contract = new ethers.Contract(contractAddress, contractABI, provider);
        // Dummy parameters – these will likely cause a revert in the real contract, but callStatic will return the revert reason.
        const batchId = 1;
        const txId = 1;
        const funder = "0x0000000000000000000000000000000000000000"; // zero address (invalid, just for simulation)
        const recipient = "0x0000000000000000000000000000000000000000";
        const amount = ethers.utils.parseUnits("0", 6); // 0 USDC
        const proof = [];

        // Use callStatic to simulate the transaction without sending it.
        const result = await contract.callStatic.executeTransaction(batchId, txId, funder, recipient, amount, proof);
        console.log("✅ callStatic succeeded, result:", result);
    } catch (error) {
        // callStatic throws on revert – we capture the revert reason if available.
        console.error("❌ callStatic reverted or failed:", error);
        if (error.error && error.error.message) {
            console.error("Revert reason:", error.error.message);
        }
    }
})();
