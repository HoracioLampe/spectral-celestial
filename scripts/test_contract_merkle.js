const ethers = require('ethers');
require('dotenv').config();

/**
 * script: test_contract_merkle.js
 * Purpose: Call the Smart Contract's `validateMerkleProofDetails` function.
 * This tests TWO things:
 * 1. That our Leaf Generation params (abi.encode) match Solidity's.
 * 2. That our Merkle Tree structure matches Solidity's verification.
 */

async function main() {
    console.log("🔗 Connecting to Polygon...");
    const providerUrl = process.env.RPC_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
    const provider = new ethers.JsonRpcProvider(providerUrl);

    // CHANGE THIS TO YOUR NEW DEPLOYED ADDRESS
    const contractAddress = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";

    const abi = [
        "function validateMerkleProofDetails(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32 root, bytes32[] calldata proof) external view returns (bool)"
    ];

    const contract = new ethers.Contract(contractAddress, abi, provider);

    // 1. Data (Same as consistency script)
    const funder = "0x8888888888888888888888888888888888888888";
    const batchId = 101n;
    // const chainId = 137n; // Implicit in the contract call (block.chainid)
    const txId = 2n;
    const recipient = "0x2222222222222222222222222222222222222222";
    const amount = 2500000n;

    // 2. The Root and Proof we KNOW are correct from our simulation
    const root = "0x35fd9c2f171ade7a1d663567321bb1fb0a405efd7b423b590f8f736578c49f1b";

    // Note: We don't send the LEAF hash anymore. We send the raw params.
    // The contract will generate the leaf using `block.chainid` and `address(this)`.

    const proof = [
        "0x03d903a726c1dd8d79551b2416e1e28077b599bb4ea0af701262c3c02e7e28f9",
        "0x9dc06681f74a4987c5a53562fbd2e40846cb606890519134986c47d2bf7e8cc3"
    ];

    console.log(`\n📡 Calling Contract: ${contractAddress}`);
    console.log(`   Function: validateMerkleProofDetails (Full Verification)`);
    console.log(`   Batch: ${batchId}, Tx: ${txId}`);
    console.log(`   Amount: ${amount}, Recipient: ${recipient}`);

    try {
        // Warning: This will FAIL if the deployed contract has a different ChainID or Address than what we simulated
        // BUT, that's exactly what we want to test! Real-world compatibility.
        // For this test script to pass against a REAL deployment, ensure you are on the right network.

        const isValid = await contract.validateMerkleProofDetails(
            batchId, txId, funder, recipient, amount, root, proof
        );
        console.log(`\n📢 Contract Response: ${isValid}`);

        if (isValid) {
            console.log("✅ SUCCESS: The Smart Contract generated the same Leaf & verified the Proof!");
        } else {
            console.error("❌ FAILURE: The Smart Contract rejected it.");
            console.error("   Possible causes: ChainID mismatch, Contract Address mismatch, or Wrong Proof.");
        }
    } catch (error) {
        console.error("\n❌ Error Calling Contract:");
        if (error.reason) console.error("   Reason:", error.reason);
        console.log(error);
        console.log("\n⚠️ NOTE: Redeploy BatchDistributor.sol to enable 'validateMerkleProofDetails'.");
    }
}

main().catch(console.error);
