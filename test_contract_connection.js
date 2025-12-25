const { ethers } = require('ethers');

const contractAddress = "0x1B9005DBb8f5EB197EaB6E2CB6555796e94663Af";
const contractABI = [
    "function processedLeaves(bytes32) view returns (bool)"
];

// Using Polygon public RPC (Mainnet). Adjust if you deployed on a testnet.
const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");

(async () => {
    try {
        const contract = new ethers.Contract(contractAddress, contractABI, provider);
        // Use a zero hash as a dummy value; the function just returns a bool.
        const dummyHash = ethers.constants.HashZero;
        const result = await contract.processedLeaves(dummyHash);
        console.log("✅ Conexión exitosa. processedLeaves(0x0) =>", result);
    } catch (error) {
        console.error("❌ Error al conectar con el contrato:", error);
    }
})();
