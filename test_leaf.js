const ethers = require('ethers');

async function testLeaf() {
    const chainId = 137;
    const contractAddress = "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
    const batchId = 75;
    const txId = 24213;
    const funder = "0x09c31e3a14404ebe473b369c94acde5ab0ebe0d0";
    const recipient = "0x2acfb17b1e8cbf3a1a690a5ce98acdb55a35abe5";
    const amount = 1000000;

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedData = abiCoder.encode(
        ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
        [
            chainId,
            contractAddress,
            BigInt(batchId),
            BigInt(txId),
            funder,
            recipient,
            BigInt(amount)
        ]
    );
    const hash = ethers.keccak256(encodedData);
    console.log("Backend Leaf Hash:", hash);

    // Simulating Solidity: keccak256(abi.encode(block.chainid, address(this), batchId, txId, funder, recipient, amount))
    // Which is EXACTLY what abiCoder.encode does.
}

testLeaf();
