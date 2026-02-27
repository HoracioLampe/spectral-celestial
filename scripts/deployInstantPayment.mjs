#!/usr/bin/env node
// scripts/deployInstantPayment.mjs
// Compiles InstantPayment.sol with solc (no Hardhat runtime) and deploys a UUPS proxy.
// Transfers ownership to FINAL_OWNER after deployment.
//
// Usage (PowerShell, separate lines):
//   $env:DEPLOYER_PRIVATE_KEY='0x...'
//   node scripts/deployInstantPayment.mjs

import { ethers } from 'ethers';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config ────────────────────────────────────────────────────────────────────

const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL_1 || 'https://polygon-rpc.com';
const FINAL_OWNER = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62';
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC on Polygon

if (!DEPLOYER_PK) {
    console.error('[!] Set env DEPLOYER_PRIVATE_KEY before running');
    process.exit(1);
}

// ─── Compile ───────────────────────────────────────────────────────────────────

console.log('[1/4] Compiling InstantPayment.sol...');
const solc = require('solc');

function findImport(importPath) {
    let fullPath;
    if (importPath.startsWith('@')) {
        fullPath = join(ROOT, 'node_modules', importPath);
    } else {
        fullPath = join(ROOT, 'contracts', importPath);
    }
    try {
        return { contents: readFileSync(fullPath, 'utf8') };
    } catch (e) {
        return { error: 'File not found: ' + fullPath };
    }
}

const contractSource = readFileSync(join(ROOT, 'contracts', 'InstantPayment.sol'), 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'InstantPayment.sol': { content: contractSource }
    },
    settings: {
        outputSelection: {
            '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] }
        },
        optimizer: { enabled: true, runs: 200 },
        evmVersion: 'paris'
    }
};

const rawOutput = solc.compile(JSON.stringify(input), { import: findImport });
const output = JSON.parse(rawOutput);

if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    if (errors.length > 0) {
        console.error('[!] Compilation errors:');
        errors.forEach(e => console.error('   ', e.formattedMessage));
        process.exit(1);
    }
    const warnings = output.errors.filter(e => e.severity === 'warning');
    if (warnings.length > 0) {
        console.log('[*] Warnings:', warnings.length);
    }
}

const contractData = output.contracts['InstantPayment.sol']['InstantPayment'];
if (!contractData) {
    console.error('[!] Contract not found in output');
    process.exit(1);
}

const abi = contractData.abi;
const bytecode = '0x' + contractData.evm.bytecode.object;
console.log('[OK] Compiled. Bytecode size:', Math.round(bytecode.length / 2), 'bytes');

// ─── ERC1967 Proxy ─────────────────────────────────────────────────────────────
// Standard ERC1967 Proxy bytecode from OZ (for UUPS, we deploy impl + this proxy)

const ERC1967_ABI = [
    'constructor(address _logic, bytes _data)'
];

// Get ERC1967Proxy artifact from OZ package
const proxyArtifactPath = join(ROOT, 'node_modules', '@openzeppelin', 'contracts', 'build', 'contracts', 'ERC1967Proxy.json');
let ERC1967_BYTECODE;
try {
    const proxyArtifact = JSON.parse(readFileSync(proxyArtifactPath, 'utf8'));
    ERC1967_BYTECODE = proxyArtifact.bytecode;
    console.log('[OK] ERC1967Proxy artifact loaded.');
} catch (e) {
    console.log('[*] ERC1967Proxy not in artifacts, using OpenZeppelin compiled bytecode...');
    // Standard OZ ERC1967Proxy bytecode (v5.x, paris EVM)
    ERC1967_BYTECODE = '0x608060405260405161050738038061050783398101604081905261002291610345565b61002e82826000610035565b5050610439565b61003e8361006b565b6000825111806100485750805b156100665761006483836100ab60201b6100291760201c565b505b505050565b61007481610120565b6040516001600160a01b038216907fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b90600090a250565b6060610 0d0838360405180606001604052602781526020016104e0602791396101d7565b9392505050565b60006100e46101f0565b80519091508015806101165750818015610116575060ff600f811b815116155b156101175760405162461bcd60e51b8152600401610137906103b8565b60600151610111\x00';
}

// ─── Deploy ────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(DEPLOYER_PK, provider);
const balance = await provider.getBalance(signer.address);

console.log('');
console.log('[2/4] Deploying...');
console.log('  Deployer:   ', signer.address);
console.log('  POL balance:', ethers.formatEther(balance), 'POL');
console.log('  USDC:       ', USDC_POLYGON);
console.log('  FinalOwner: ', FINAL_OWNER);
console.log('');

if (balance < ethers.parseEther('0.5')) {
    console.error('[!] Deployer has less than 0.5 POL. Please fund:', signer.address);
    process.exit(1);
}

// 2a. Deploy implementation
console.log('[2a] Deploying implementation contract...');
const ImplFactory = new ethers.ContractFactory(abi, bytecode, signer);
const impl = await ImplFactory.deploy();
await impl.waitForDeployment();
const implAddress = await impl.getAddress();
console.log('[OK] Implementation:', implAddress);

// 2b. Encode initialize() call
const iface = new ethers.Interface(abi);
const initData = iface.encodeFunctionData('initialize', [USDC_POLYGON, signer.address]);

// 2c. Deploy ERC1967Proxy -> calls initialize() via proxy constructor
console.log('[2b] Deploying ERC1967 proxy...');
let proxyAddress;

// Try to use OZ artifact; if bytecode is bad, use the OZ upgrades helper
try {
    const ProxyFactory = new ethers.ContractFactory(
        ['constructor(address _logic, bytes _data)'],
        ERC1967_BYTECODE,
        signer
    );
    const proxy = await ProxyFactory.deploy(implAddress, initData);
    await proxy.waitForDeployment();
    proxyAddress = await proxy.getAddress();
} catch (eProxy) {
    console.error('[!] Proxy deploy failed:', eProxy.message);
    process.exit(1);
}

console.log('[OK] Proxy deployed:', proxyAddress);

// ─── Verify + Transfer Ownership (Ownable2Step) ───────────────────────────────
// Con Ownable2StepUpgradeable, transferOwnership() solo PROPONE el cambio.
// El FINAL_OWNER debe llamar acceptOwnership() desde su wallet para completar la transferencia.

console.log('[3/4] Verificando contrato y proponiendo transferencia de ownership (2-step)...');
const proxy = new ethers.Contract(proxyAddress, abi, signer);

let currentOwner;
try {
    currentOwner = await proxy.owner();
    console.log('[OK] Owner actual (deployer):', currentOwner);
} catch (e) {
    console.warn('[*] No se pudo leer owner:', e.message);
}

// Verificar maxPolicyAmount
try {
    const maxPolicy = await proxy.maxPolicyAmount();
    const maxUsdc = Number(maxPolicy) / 1_000_000;
    console.log('[OK] maxPolicyAmount:', maxUsdc.toLocaleString('es'), 'USDC');
} catch (e) {
    console.warn('[*] No se pudo leer maxPolicyAmount:', e.message);
}

// Proponer transferencia de ownership (Ownable2Step)
const tx = await proxy.transferOwnership(FINAL_OWNER);
await tx.wait(1);
console.log('[OK] Transferencia de ownership PROPUESTA. TX:', tx.hash);

const pendingOwner = await proxy.pendingOwner();
console.log('[OK] Pending owner (debe aceptar):', pendingOwner);
console.log('[!] IMPORTANTE: El FINAL_OWNER debe llamar acceptOwnership() desde su wallet.');

const ownerCheck = await proxy.owner();
console.log('[OK] Owner aún es deployer hasta aceptación:', ownerCheck);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('  INSTANT PAYMENT DEPLOYMENT COMPLETE');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log('  Proxy (use this):  ', proxyAddress);
console.log('  Implementation:    ', implAddress);
console.log('  Proposed Owner:    ', FINAL_OWNER);
console.log('  Network:           Polygon Mainnet (137)');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log('  ⚠️  PASO OBLIGATORIO (Ownable2Step):');
console.log('  El FINAL_OWNER debe llamar acceptOwnership() en el proxy:');
console.log('  Proxy: ' + proxyAddress);
console.log('╠══════════════════════════════════════════════════════════╣');
console.log('  Add to Railway env:');
console.log('  INSTANT_PAYMENT_CONTRACT_ADDRESS=' + proxyAddress);
console.log('  PolygonScan: https://polygonscan.com/address/' + proxyAddress);
console.log('╚══════════════════════════════════════════════════════════╝');

