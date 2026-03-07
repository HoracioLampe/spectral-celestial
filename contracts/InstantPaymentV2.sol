// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title IERC20Permit
 * @dev Minimal interface for USDC (ERC-20 + ERC-2612 permit)
 */
interface IERC20Permit {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/**
 * @title InstantPayment V2
 * @dev Simplified policy model:
 *   - Policy tracks: initialAmount (display), consumedAmount (display), deadline (enforcement), isActive
 *   - Budget enforcement: ERC-20 allowance (transferFrom reverts if exhausted)
 *   - No ExceedsPolicyLimit check — allowance IS the budget
 *   - activatePolicyWithPermit: atomic (USDC.permit + activatePolicy in one TX)
 *   - One deadline controls both permit validity and policy expiry
 *
 * Storage note: Policy.initialAmount occupies same slot as V1's totalAmount — no collision.
 */
contract InstantPaymentV2 is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    EIP712Upgradeable
{
    using ECDSA for bytes32;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Policy {
        uint256 initialAmount;   // [SLOT 0] Amount set at activation (display only, replaces V1 totalAmount)
        uint256 consumedAmount;  // [SLOT 1] USDC spent (display only — ERC-20 allowance is the real budget)
        uint256 deadline;        // [SLOT 2] Unix timestamp — policy + permit expiry
        bool    isActive;        // [SLOT 3]
    }

    // ─── EIP-712 ──────────────────────────────────────────────────────────────

    /// @dev "RegisterRelayer(address coldWallet,address relayer,uint256 deadline,uint256 nonce)"
    bytes32 public constant REGISTER_RELAYER_TYPEHASH = keccak256(
        "RegisterRelayer(address coldWallet,address relayer,uint256 deadline,uint256 nonce)"
    );

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20Permit public usdcToken;

    /// @dev coldWallet => authorized hot relayer (faucet wallet)
    mapping(address => address) public coldWalletRelayer;

    /// @dev transferId => executed
    mapping(bytes32 => bool) public transfers;

    /// @dev coldWallet => nonce para RegisterRelayer (anti-replay)
    mapping(address => uint256) public relayerNonces;

    /// @dev coldWallet => Policy
    mapping(address => Policy) public policies;

    /// @dev Maximum USDC configurable in a policy permit (6 decimals). Default: 20,000 USDC
    uint256 public maxPolicyAmount;

    // ─── Events ───────────────────────────────────────────────────────────────

    event RelayerRegistered(address indexed coldWallet, address indexed relayer);
    event PolicyActivated(address indexed coldWallet, uint256 initialAmount, uint256 deadline);
    event TransferExecuted(bytes32 indexed transferId, address indexed from, address indexed to, uint256 amount);
    event PolicyReset(address indexed coldWallet);
    event MaxPolicyAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotAuthorizedRelayer(address caller, address coldWallet);
    error NotAuthorizedToReset(address caller);
    error AlreadyExecuted(bytes32 transferId);
    error PolicyExpired(address coldWallet);
    error PolicyInactive(address coldWallet);
    error ExceedsMaxPolicyAmount(uint256 requested, uint256 maxAllowed);
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error ZeroAmount();
    error InvalidAddress();
    error SignatureExpired();
    error InvalidSignature();
    error TransferFailed();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyRelayerOf(address coldWallet) {
        if (msg.sender != coldWalletRelayer[coldWallet]) {
            revert NotAuthorizedRelayer(msg.sender, coldWallet);
        }
        _;
    }

    // ─── Initializer ──────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _usdcToken, address _owner) public initializer {
        if (_usdcToken == address(0)) revert InvalidAddress();
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __EIP712_init("InstantPayment", "1");
        usdcToken = IERC20Permit(_usdcToken);
        maxPolicyAmount = 20_000e6; // Default: 20,000 USDC (6 decimals)
    }

    // ─── Relayer Registration ─────────────────────────────────────────────────

    /**
     * @notice Register an authorized relayer for a cold wallet.
     *         The cold wallet signs the EIP-712 message off-chain.
     *         Anyone can submit (gas paid by relayer/faucet).
     */
    function registerRelayer(
        address coldWallet,
        address relayer,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (coldWallet == address(0) || relayer == address(0)) revert InvalidAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        uint256 currentNonce = relayerNonces[coldWallet];

        bytes32 structHash = keccak256(abi.encode(
            REGISTER_RELAYER_TYPEHASH,
            coldWallet,
            relayer,
            deadline,
            currentNonce
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);

        if (signer != coldWallet) revert InvalidSignature();

        relayerNonces[coldWallet] = currentNonce + 1;
        coldWalletRelayer[coldWallet] = relayer;
        emit RelayerRegistered(coldWallet, relayer);
    }

    function getRelayerNonce(address coldWallet) external view returns (uint256) {
        return relayerNonces[coldWallet];
    }

    // ─── Policy Management ────────────────────────────────────────────────────

    /**
     * @notice Activate policy + set USDC allowance atomically in ONE transaction.
     *         Cold wallet signs EIP-2612 permit off-chain (no gas cost for cold wallet).
     *         Only callable by the registered relayer (faucet pays gas).
     *
     * @param coldWallet   Address of the cold wallet (funder)
     * @param amount       USDC amount (6 decimals) — sets both allowance and initialAmount
     * @param deadline     Unix timestamp: policy expires AND permit expires at same time
     * @param v, r, s      EIP-2612 permit signature from coldWallet
     */
    function activatePolicyWithPermit(
        address coldWallet,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRelayerOf(coldWallet) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > maxPolicyAmount) revert ExceedsMaxPolicyAmount(amount, maxPolicyAmount);
        if (deadline <= block.timestamp) revert PolicyExpired(coldWallet);

        // 1. Set ERC-20 allowance via permit (faucet pays gas, cold wallet only signed)
        usdcToken.permit(coldWallet, address(this), amount, deadline, v, r, s);

        // 2. Activate policy (same TX — atomic)
        policies[coldWallet] = Policy({
            initialAmount:   amount,
            consumedAmount:  0,
            deadline:        deadline,
            isActive:        true
        });

        emit PolicyActivated(coldWallet, amount, deadline);
    }

    /**
     * @notice Legacy: Activate policy without permit (for cases where allowance already set).
     *         Only callable by the registered relayer.
     */
    function activatePolicy(
        address coldWallet,
        uint256 totalAmount,
        uint256 deadline
    ) external onlyRelayerOf(coldWallet) whenNotPaused {
        if (totalAmount == 0) revert ZeroAmount();
        if (totalAmount > maxPolicyAmount) revert ExceedsMaxPolicyAmount(totalAmount, maxPolicyAmount);
        if (deadline <= block.timestamp) revert PolicyExpired(coldWallet);

        policies[coldWallet] = Policy({
            initialAmount:   totalAmount,
            consumedAmount:  0,
            deadline:        deadline,
            isActive:        true
        });

        emit PolicyActivated(coldWallet, totalAmount, deadline);
    }

    /**
     * @notice Reset (deactivate) a policy.
     *         Callable by cold wallet's registered relayer OR by the owner.
     */
    function resetPolicy(address coldWallet) external {
        if (msg.sender != coldWallet &&
            msg.sender != coldWalletRelayer[coldWallet] &&
            msg.sender != owner()) {
            revert NotAuthorizedToReset(msg.sender);
        }
        policies[coldWallet].isActive = false;
        emit PolicyReset(coldWallet);
    }

    /**
     * @notice Atómicamente: zeroes the USDC allowance via EIP-2612 permit(value=0),
     *         sets policy deadline to block.timestamp, marks policy inactive.
     *         Cold wallet signs off-chain — faucet pays gas. One TX for everything.
     * @param coldWallet     Address of the cold wallet
     * @param permitDeadline Short validity window (e.g. now+120s)
     * @param v, r, s        EIP-2612 permit signature from coldWallet for value=0
     */
    function resetPolicyWithPermit(
        address coldWallet,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (msg.sender != coldWalletRelayer[coldWallet] &&
            msg.sender != owner()) {
            revert NotAuthorizedToReset(msg.sender);
        }
        // 1. Zero out ERC-20 allowance via permit(value=0) — atomic, faucet pays gas
        usdcToken.permit(coldWallet, address(this), 0, permitDeadline, v, r, s);
        // 2. Set deadline = now (policy expired on-chain)
        policies[coldWallet].deadline = block.timestamp;
        // 3. Deactivate
        policies[coldWallet].isActive = false;
        emit PolicyReset(coldWallet);
    }

    // ─── Transfer Execution ───────────────────────────────────────────────────

    /**
     * @notice Execute a single USDC transfer.
     *         Budget enforcement: ERC-20 allowance (transferFrom reverts if exhausted).
     *         Policy enforcement: isActive + deadline only.
     *         No ExceedsPolicyLimit — allowance IS the budget.
     *
     * @param transferId Unique identifier (bytes32 from UUID) — idempotency
     * @param from       Cold wallet (has given allowance via permit)
     * @param to         Destination wallet
     * @param amount     USDC amount (6 decimals)
     */
    function executeTransfer(
        bytes32 transferId,
        address from,
        address to,
        uint256 amount
    ) external onlyRelayerOf(from) nonReentrant whenNotPaused {
        // ── Idempotency ───────────────────────────────────────────────────
        if (transfers[transferId]) revert AlreadyExecuted(transferId);

        // ── Policy validation (time gate only) ────────────────────────────
        Policy storage policy = policies[from];
        if (!policy.isActive)                  revert PolicyInactive(from);
        if (block.timestamp > policy.deadline) revert PolicyExpired(from);
        if (amount == 0)                       revert ZeroAmount();
        if (to == address(0))                  revert InvalidAddress();

        // ── Allowance check (ERC-20 is the budget) ────────────────────────
        uint256 currentAllowance = usdcToken.allowance(from, address(this));
        if (currentAllowance < amount) revert InsufficientAllowance(currentAllowance, amount);

        // ── Mark executed + track consumed (display only) ─────────────────
        transfers[transferId] = true;
        policy.consumedAmount += amount;

        // ── Execute (CEI pattern — state updated before external call) ────
        if (!usdcToken.transferFrom(from, to, amount)) revert TransferFailed();

        emit TransferExecuted(transferId, from, to, amount);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function isTransferExecuted(bytes32 transferId) external view returns (bool) {
        return transfers[transferId];
    }

    /**
     * @notice Returns policy info + live allowance from ERC-20.
     * @return initialAmount  Amount set at activation (display)
     * @return consumedAmount USDC spent so far (display)
     * @return remaining      Current ERC-20 allowance (real available budget)
     * @return deadline       Policy expiry timestamp
     * @return isActive       Whether policy is active
     * @return isExpired      Whether deadline has passed
     */
    function getPolicyBalance(address coldWallet)
        external
        view
        returns (
            uint256 initialAmount,
            uint256 consumedAmount,
            uint256 remaining,
            uint256 deadline,
            bool    isActive,
            bool    isExpired
        )
    {
        Policy storage p = policies[coldWallet];
        initialAmount  = p.initialAmount;
        consumedAmount = p.consumedAmount;
        remaining      = usdcToken.allowance(coldWallet, address(this)); // Live from ERC-20
        deadline       = p.deadline;
        isActive       = p.isActive;
        isExpired      = block.timestamp > p.deadline;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns the contract implementation version string.
    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMaxPolicyAmount(uint256 newMax) external onlyOwner {
        if (newMax == 0) revert ZeroAmount();
        emit MaxPolicyAmountUpdated(maxPolicyAmount, newMax);
        maxPolicyAmount = newMax;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── UUPS ─────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ─── Storage Gap ──────────────────────────────────────────────────────────
    // Same gap size as V1 (44 slots). No new state variables added in V2.
    uint256[44] private __gap;
}
