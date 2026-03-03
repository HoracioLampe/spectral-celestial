import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const COLD_WALLET = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62';

const ABI = [
    'function coldWalletRelayer(address) view returns (address)',
    'function getRelayerNonce(address) view returns (uint256)',
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);
const contract = new ethers.Contract(PROXY, ABI, provider);

const relayer = await contract.coldWalletRelayer(COLD_WALLET);
const nonce = await contract.getRelayerNonce(COLD_WALLET);

console.log('Cold wallet:', COLD_WALLET);
console.log('Registered relayer:', relayer);
console.log('Nonce:', nonce.toString());
console.log('Is zero (not registered):', relayer === ethers.ZeroAddress);
