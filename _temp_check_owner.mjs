import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const PROXY = '0x971da9d642C94f6B5E3867EC891FBA7ef8287d29';
const ABI = [
    'function owner() view returns (address)',
    'function pendingOwner() view returns (address)',
];

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);
const contract = new ethers.Contract(PROXY, ABI, provider);

const owner = await contract.owner();
const pending = await contract.pendingOwner();
console.log('Current owner:', owner);
console.log('Pending owner:', pending);
console.log('Deployer:', '0x8719CD06973A282DC8abBfA6936aAD27Fea6bc81');
console.log('Is deployer the owner:', owner.toLowerCase() === '0x8719cd06973a282dc8abbfa6936aad27fea6bc81');
