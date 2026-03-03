const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpc = process.env.RPC_URL_1;
    const provider = new ethers.JsonRpcProvider(rpc);
    const contractAddr = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;
    const coldWallet = '0x3212a0A346dd7D17BE5b8cE8d441767Ae18FE6A8';

    console.log(`Checking Contract: ${contractAddr}`);
    console.log(`Cold Wallet: ${coldWallet}`);

    const abi = [
        'function coldWalletRelayer(address) view returns (address)',
        'function relayerNonces(address) view returns (uint256)',
        'function maxPolicyAmount() view returns (uint256)',
        'function policies(address) view returns (uint256 totalAmount, uint256 consumedAmount, uint256 deadline, bool isActive)'
    ];

    const contract = new ethers.Contract(contractAddr, abi, provider);

    const registeredRelayer = await contract.coldWalletRelayer(coldWallet);
    const nonce = await contract.relayerNonces(coldWallet);
    const maxPolicy = await contract.maxPolicyAmount();
    const policy = await contract.policies(coldWallet);

    console.log('--- Contract State ---');
    console.log(`Registered Relayer: ${registeredRelayer}`);
    console.log(`Relayer Nonce: ${nonce}`);
    console.log(`Max Policy Amount: ${ethers.formatUnits(maxPolicy, 6)} USDC`);
    console.log('--- Active Policy ---');
    console.log(`Is Active: ${policy.isActive}`);
    console.log(`Total: ${ethers.formatUnits(policy.totalAmount, 6)} USDC`);
    console.log(`Consumed: ${ethers.formatUnits(policy.consumedAmount, 6)} USDC`);
    console.log(`Deadline: ${new Date(Number(policy.deadline) * 1000).toLocaleString()}`);
}

main().catch(console.error);
