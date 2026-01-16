require('dotenv').config();
const ethers = require('ethers');

async function check() {
    console.log("--- Environment Check ---");
    console.log("PROVIDER_URL configured:", process.env.PROVIDER_URL ? "YES" : "NO");
    console.log("CONTRACT_ADDRESS configured:", process.env.CONTRACT_ADDRESS ? "YES" : "NO");
    console.log("Value:", process.env.CONTRACT_ADDRESS || "Using Default 0x7B25...");

    const providerUrl = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
    console.log("Using Provider URL:", providerUrl.substring(0, 50) + "...");

    try {
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const network = await provider.getNetwork();
        console.log("Connected to Chain ID:", network.chainId.toString());
        console.log("Chain Name:", network.name);
    } catch (e) {
        console.error("Failed to connect to provider:", e.message);
    }
}

check();
