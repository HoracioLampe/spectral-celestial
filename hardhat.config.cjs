require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('@openzeppelin/hardhat-upgrades');

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: '0.8.26',
        settings: {
            optimizer: { enabled: true, runs: 200 },
        },
    },
    networks: {
        polygon: {
            url: process.env.RPC_URL_1 || 'https://polygon-rpc.com',
            chainId: 137,
            accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
            gasPrice: 'auto',
        },
    },
};
