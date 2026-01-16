const { ethers } = require('ethers');

const USDC_ADDRESS = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const TARGET_HASH = "0xcaa2ce1a5703ccbe253a34eb3166df60a705c561b44b192061e28f2a985be2ca";
const CHAIN_ID = 137;

const TYPEHASHES = [
    {
        name: "Standard",
        hash: ethers.id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        fields: ["bytes32", "bytes32", "bytes32", "uint256", "address"]
    },
    {
        name: "With Salt",
        hash: ethers.id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"),
        fields: ["bytes32", "bytes32", "bytes32", "uint256", "address", "bytes32"]
    }
];

const NAMES = ["USD Coin", "USDC", "USD Coin (PoS)"];
const VERSIONS = ["1", "2"];
const SALTS = [null, ethers.toBeHex(CHAIN_ID, 32)];

console.log("Target:", TARGET_HASH);

for (const type of TYPEHASHES) {
    for (const name of NAMES) {
        for (const ver of VERSIONS) {
            for (const salt of SALTS) {
                if (type.name === "Standard" && salt !== null) continue;
                if (type.name === "With Salt" && salt === null) continue;

                const nameHash = ethers.id(name);
                const verHash = ethers.id(ver);

                let encoded;
                if (salt) {
                    encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                        type.fields,
                        [type.hash, nameHash, verHash, CHAIN_ID, USDC_ADDRESS, salt]
                    );
                } else {
                    encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                        type.fields,
                        [type.hash, nameHash, verHash, CHAIN_ID, USDC_ADDRESS]
                    );
                }

                const hash = ethers.keccak256(encoded);
                if (hash === TARGET_HASH) {
                    console.log("!!! MATCH FOUND !!!");
                    console.log(`Type: ${type.name}, Name: "${name}", Ver: "${ver}", Salt: ${salt}`);
                    process.exit(0);
                }
            }
        }
    }
}
console.log("No match found in standard permutations.");
