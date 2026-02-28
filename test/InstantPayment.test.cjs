// test/InstantPayment.test.cjs
// Hardhat + Ethers.js v6 + OpenZeppelin Upgrades
// Run: npx hardhat test

const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

// ── Helpers ────────────────────────────────────────────────────────────────────

const ZERO = ethers.ZeroAddress;
const ONE_USDC = ethers.parseUnits('1', 6);
const HUNDRED_USDC = ethers.parseUnits('100', 6);

function days(n) {
    return Math.floor(Date.now() / 1000) + n * 86400;
}

function toBytes32(uuid) {
    return ethers.keccak256(ethers.toUtf8Bytes(uuid));
}

// ── Mock USDC ──────────────────────────────────────────────────────────────────
// Deploys an inline mock via ethers — transferFrom returns `returnValue`

async function deployMockUSDC(signer, returnValue = true) {
    // Minimal ERC20 that lets us control transferFrom return value
    const abi = [
        'function transferFrom(address,address,uint256) returns (bool)',
        'function allowance(address,address) view returns (uint256)',
        'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
        'function setReturnValue(bool)',
        'function setAllowance(uint256)',
    ];
    const bytecode =
        '0x608060405234801561001057600080fd5b506040516103e83803806103e883398101604081905261002f91610054565b60005550610078565b5060015b905061006a565b80151581146100515760005b915061005b565b919050565b60006020828403121561006657600080fd5b815161007181610039565b9392505050565b610361806100876000396000f3fe608060405234801561001057600080fd5b506004361061004c5760003560e01c806323b872dd14610051578063dd62ed3e14610083578063d8f4648f146100a5578063a37fc369146100ba575b600080fd5b61006461005f366004610256565b6100cc565b604051901515815260200160405180910390f35b610096610091366004610292565b6100e2565b60405190815260200160405180910390f35b6100b86100b33660046102bc565b6100f1565b005b6100b86100c8366004610256565b50565b60006100d46000546100f8565b5060015492915050565b506001919050565b600155565b60015492915050565b9392505050565b60008060408385031215610109565b81359150602083013561010b565b8035801515811461012257600080fd5b92915050565b60008060006060848603121561012957600080fd5b61013084610126565b60209490940135915060009290925050919050565b803573ffffffffffffffffffffffffffffffffffffffff8116811461012257600080fd5b6000806040838503121561018457600080fd5b61018d83610145565b915061019b60208401610145565b90509250929050565b6000602082840312156101b657600080fd5b5035919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b600082601f8301126101fc57600080fd5b813567ffffffffffffffff8082111561021757610217ffffffff565b604051601f83017fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe0908116603f0116810167ffffffffffffffff8111828210171561026357610263565b60405283815290508282016020018510156102805760019150505b9050565b6000602082840312156102925750565b81601f830112156102a257600080fd5b61012f565b636aad06df600081146102c157600080fd5b6102505750565b5050565b50600080fd5b600060208284031215610100565b60e0928390039091019050565b50600181146100d35750565b80351515811461012257600080fd5b60008061008b820161017e565b50565b73ffffffffffffffffffffffffffffffffffffffff16600052505050565b50600090565b6312020f00565b73ffffffffffffffffffffffffffffffffffffffff8651166110000052565b509190505050565bf3fe';

    // Use a simpler approach: deploy a contract that always returns `returnValue`
    // We'll use a factory with inline Solidity source
    const MockUSDC = await ethers.getContractFactory('MockUSDC', signer);
    return MockUSDC.deploy(returnValue);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('InstantPayment', function () {
    let contract;
    let mockUSDC;
    let owner, coldWallet, relayer, recipient, other;

    beforeEach(async function () {
        [owner, coldWallet, relayer, recipient, other] = await ethers.getSigners();

        // Deploy MockUSDC that returns true by default
        const MockUSDCFactory = await ethers.getContractFactory('MockUSDC');
        mockUSDC = await MockUSDCFactory.deploy(true);

        // Deploy InstantPayment as UUPS proxy
        const IP = await ethers.getContractFactory('InstantPayment');
        contract = await upgrades.deployProxy(IP, [
            await mockUSDC.getAddress(),
            owner.address,
        ], { kind: 'uups' });
        await contract.waitForDeployment();
    });

    // ─── initialize() ────────────────────────────────────────────────────────

    describe('initialize()', function () {
        it('reverts with InvalidAddress if _usdcToken is zero address', async function () {
            const IP = await ethers.getContractFactory('InstantPayment');
            await expect(
                upgrades.deployProxy(IP, [ZERO, owner.address], { kind: 'uups' })
            ).to.be.revertedWithCustomError(contract, 'InvalidAddress');
        });

        it('sets usdcToken correctly', async function () {
            expect(await contract.usdcToken()).to.equal(await mockUSDC.getAddress());
        });

        it('sets owner correctly', async function () {
            expect(await contract.owner()).to.equal(owner.address);
        });
    });

    // ─── registerRelayer() ───────────────────────────────────────────────────

    describe('registerRelayer()', function () {
        async function signRelayer(cold, relayerAddr, deadline, nonce) {
            const domain = {
                name: 'InstantPayment',
                version: '1',
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await contract.getAddress(),
            };
            const types = {
                RegisterRelayer: [
                    { name: 'coldWallet', type: 'address' },
                    { name: 'relayer', type: 'address' },
                    { name: 'deadline', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                ],
            };
            const value = { coldWallet: cold.address, relayer: relayerAddr, deadline, nonce };
            return cold.signTypedData(domain, types, value);
        }

        it('registers relayer with valid signature', async function () {
            const deadline = days(1);
            const nonce = await contract.getRelayerNonce(coldWallet.address);
            const sig = await signRelayer(coldWallet, relayer.address, deadline, nonce);

            await contract.registerRelayer(coldWallet.address, relayer.address, deadline, sig);
            expect(await contract.coldWalletRelayer(coldWallet.address)).to.equal(relayer.address);
        });

        it('reverts SignatureExpired if deadline is in the past', async function () {
            const deadline = Math.floor(Date.now() / 1000) - 1;
            const nonce = await contract.getRelayerNonce(coldWallet.address);
            const sig = await signRelayer(coldWallet, relayer.address, deadline, nonce);

            await expect(
                contract.registerRelayer(coldWallet.address, relayer.address, deadline, sig)
            ).to.be.revertedWithCustomError(contract, 'SignatureExpired');
        });

        it('reverts InvalidSignature if signer is wrong', async function () {
            const deadline = days(1);
            const nonce = await contract.getRelayerNonce(coldWallet.address);
            const sig = await signRelayer(other, relayer.address, deadline, nonce); // wrong signer

            await expect(
                contract.registerRelayer(coldWallet.address, relayer.address, deadline, sig)
            ).to.be.revertedWithCustomError(contract, 'InvalidSignature');
        });

        it('reverts InvalidAddress if coldWallet or relayer is zero', async function () {
            const deadline = days(1);
            const nonce = 0n;
            const sig = '0x' + '00'.repeat(65);
            await expect(
                contract.registerRelayer(ZERO, relayer.address, deadline, sig)
            ).to.be.revertedWithCustomError(contract, 'InvalidAddress');
        });
    });

    // ─── activatePolicy() ────────────────────────────────────────────────────

    describe('activatePolicy()', function () {
        beforeEach(async function () {
            // Register relayer first
            const deadline = days(1);
            const nonce = await contract.getRelayerNonce(coldWallet.address);
            const domain = {
                name: 'InstantPayment', version: '1',
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await contract.getAddress(),
            };
            const types = {
                RegisterRelayer: [
                    { name: 'coldWallet', type: 'address' },
                    { name: 'relayer', type: 'address' },
                    { name: 'deadline', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                ]
            };
            const sig = await coldWallet.signTypedData(domain, types,
                { coldWallet: coldWallet.address, relayer: relayer.address, deadline, nonce });
            await contract.registerRelayer(coldWallet.address, relayer.address, deadline, sig);
        });

        it('activates policy with valid params', async function () {
            await contract.connect(relayer).activatePolicy(
                coldWallet.address, HUNDRED_USDC, days(7)
            );
            const policy = await contract.getPolicyBalance(coldWallet.address);
            expect(policy.isActive).to.be.true;
            expect(policy.totalAmount).to.equal(HUNDRED_USDC);
        });

        it('reverts NotAuthorizedRelayer if called by non-relayer', async function () {
            await expect(
                contract.connect(other).activatePolicy(coldWallet.address, HUNDRED_USDC, days(7))
            ).to.be.revertedWithCustomError(contract, 'NotAuthorizedRelayer');
        });

        it('reverts ZeroAmount if totalAmount is 0', async function () {
            await expect(
                contract.connect(relayer).activatePolicy(coldWallet.address, 0, days(7))
            ).to.be.revertedWithCustomError(contract, 'ZeroAmount');
        });

        it('reverts ExceedsMaxPolicyAmount if over limit', async function () {
            const overLimit = ethers.parseUnits('21000', 6); // > 20_000
            await expect(
                contract.connect(relayer).activatePolicy(coldWallet.address, overLimit, days(7))
            ).to.be.revertedWithCustomError(contract, 'ExceedsMaxPolicyAmount');
        });
    });

    // ─── executeTransfer() ───────────────────────────────────────────────────

    describe('executeTransfer()', function () {
        const transferId = toBytes32('test-transfer-001');

        beforeEach(async function () {
            // Register relayer
            const deadline = days(1);
            const nonce = await contract.getRelayerNonce(coldWallet.address);
            const domain = {
                name: 'InstantPayment', version: '1',
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await contract.getAddress(),
            };
            const types = {
                RegisterRelayer: [
                    { name: 'coldWallet', type: 'address' },
                    { name: 'relayer', type: 'address' },
                    { name: 'deadline', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                ]
            };
            const sig = await coldWallet.signTypedData(domain, types,
                { coldWallet: coldWallet.address, relayer: relayer.address, deadline, nonce });
            await contract.registerRelayer(coldWallet.address, relayer.address, deadline, sig);

            // Set allowance on mock (100 USDC)
            await mockUSDC.setAllowance(HUNDRED_USDC);

            // Activate policy
            await contract.connect(relayer).activatePolicy(
                coldWallet.address, HUNDRED_USDC, days(7)
            );
        });

        it('executes transfer successfully and emits event', async function () {
            await expect(
                contract.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, ONE_USDC
                )
            ).to.emit(contract, 'TransferExecuted')
                .withArgs(transferId, coldWallet.address, recipient.address, ONE_USDC);
        });

        it('reverts TransferFailed when transferFrom returns false', async function () {
            // Deploy a new mock that returns false
            const MockUSDCFactory = await ethers.getContractFactory('MockUSDC');
            const failingUsdc = await MockUSDCFactory.deploy(false);
            await failingUsdc.setAllowance(HUNDRED_USDC);

            // Redeploy contract with failing USDC
            const IP = await ethers.getContractFactory('InstantPayment');
            const contractWithFailUsdc = await upgrades.deployProxy(IP, [
                await failingUsdc.getAddress(), owner.address,
            ], { kind: 'uups' });

            // Register relayer + activate policy on the new contract
            const deadline = days(1);
            const nonce = await contractWithFailUsdc.getRelayerNonce(coldWallet.address);
            const domain = {
                name: 'InstantPayment', version: '1',
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await contractWithFailUsdc.getAddress(),
            };
            const types = {
                RegisterRelayer: [
                    { name: 'coldWallet', type: 'address' },
                    { name: 'relayer', type: 'address' },
                    { name: 'deadline', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                ]
            };
            const sig = await coldWallet.signTypedData(domain, types,
                { coldWallet: coldWallet.address, relayer: relayer.address, deadline, nonce });
            await contractWithFailUsdc.registerRelayer(coldWallet.address, relayer.address, deadline, sig);
            await contractWithFailUsdc.connect(relayer).activatePolicy(
                coldWallet.address, HUNDRED_USDC, days(7)
            );

            await expect(
                contractWithFailUsdc.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, ONE_USDC
                )
            ).to.be.revertedWithCustomError(contractWithFailUsdc, 'TransferFailed');
        });

        it('reverts AlreadyExecuted on duplicate transferId', async function () {
            await contract.connect(relayer).executeTransfer(
                transferId, coldWallet.address, recipient.address, ONE_USDC
            );
            await expect(
                contract.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, ONE_USDC
                )
            ).to.be.revertedWithCustomError(contract, 'AlreadyExecuted');
        });

        it('reverts ExceedsPolicyLimit when amount > remaining', async function () {
            const overLimit = HUNDRED_USDC + 1n;
            await expect(
                contract.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, overLimit
                )
            ).to.be.revertedWithCustomError(contract, 'ExceedsPolicyLimit');
        });

        it('reverts PolicyInactive if no policy set', async function () {
            const IP = await ethers.getContractFactory('InstantPayment');
            const fresh = await upgrades.deployProxy(IP, [
                await mockUSDC.getAddress(), owner.address,
            ], { kind: 'uups' });
            // Register relayer on fresh contract (no policy)
            const deadline = days(1);
            const nonce = await fresh.getRelayerNonce(coldWallet.address);
            const domain = {
                name: 'InstantPayment', version: '1',
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await fresh.getAddress(),
            };
            const types = {
                RegisterRelayer: [
                    { name: 'coldWallet', type: 'address' },
                    { name: 'relayer', type: 'address' },
                    { name: 'deadline', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                ]
            };
            const sig = await coldWallet.signTypedData(domain, types,
                { coldWallet: coldWallet.address, relayer: relayer.address, deadline, nonce });
            await fresh.registerRelayer(coldWallet.address, relayer.address, deadline, sig);

            await expect(
                fresh.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, ONE_USDC
                )
            ).to.be.revertedWithCustomError(fresh, 'PolicyInactive');
        });

        it('reverts InsufficientAllowance when allowance is too low', async function () {
            await mockUSDC.setAllowance(0); // Zero allowance
            await expect(
                contract.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, ONE_USDC
                )
            ).to.be.revertedWithCustomError(contract, 'InsufficientAllowance');
        });

        it('reverts ZeroAmount', async function () {
            await expect(
                contract.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, recipient.address, 0
                )
            ).to.be.revertedWithCustomError(contract, 'ZeroAmount');
        });

        it('reverts InvalidAddress if recipient is zero', async function () {
            await expect(
                contract.connect(relayer).executeTransfer(
                    transferId, coldWallet.address, ZERO, ONE_USDC
                )
            ).to.be.revertedWithCustomError(contract, 'InvalidAddress');
        });
    });

    // ─── Admin ───────────────────────────────────────────────────────────────

    describe('Admin — pause/unpause/setMaxPolicyAmount', function () {
        it('owner can pause and unpause', async function () {
            await contract.connect(owner).pause();
            expect(await contract.paused()).to.be.true;
            await contract.connect(owner).unpause();
            expect(await contract.paused()).to.be.false;
        });

        it('non-owner cannot pause', async function () {
            await expect(
                contract.connect(other).pause()
            ).to.be.reverted;
        });

        it('setMaxPolicyAmount updates the limit', async function () {
            const newMax = ethers.parseUnits('50000', 6);
            await contract.connect(owner).setMaxPolicyAmount(newMax);
            expect(await contract.maxPolicyAmount()).to.equal(newMax);
        });

        it('setMaxPolicyAmount reverts ZeroAmount if 0', async function () {
            await expect(
                contract.connect(owner).setMaxPolicyAmount(0)
            ).to.be.revertedWithCustomError(contract, 'ZeroAmount');
        });
    });
});
