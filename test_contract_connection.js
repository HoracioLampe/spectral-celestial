const { ethers } = require('ethers');

const contractAddress = process.env.CONTRACT_ADDRESS || "0x78318c7A0d4E7e403A5008F9DA066A489B65cBad";
const contractABI = [
    "function processedLeaves(bytes32) view returns (bool)"
];

// Using Polygon public RPC (Mainnet). Adjust if you deployed on a testnet.
const provider = new ethers.JsonRpcProvider("https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/");

(async () => {
    try {
        const contract = new ethers.Contract(contractAddress, contractABI, provider);
        // Use a zero hash as a dummy value; the function just returns a bool.
        const dummyHash = ethers.ZeroHash;
        const result = await contract.processedLeaves(dummyHash);
        console.log("✅ Conexión exitosa. processedLeaves(0x0) =>", result);
    } catch (error) {
        console.error("❌ Error al conectar con el contrato:", error);
    }
})();
