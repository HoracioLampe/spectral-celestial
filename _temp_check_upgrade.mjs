import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);
const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const V2_IMPL = '0xbfc16912aE0b3DAb4e43fC4D4FcF33CF5ddb23C0';

// EIP-1967 implementation slot
const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const raw = await provider.getStorage(PROXY, slot);
const impl = '0x' + raw.slice(26);

console.log('Implementation:', impl);
console.log('Expected V2:   ', V2_IMPL);
console.log('Is V2:', impl.toLowerCase() === V2_IMPL.toLowerCase());
