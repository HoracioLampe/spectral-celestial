// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
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
 * @title InstantPayment
 * @dev UUPS upgradeable contract for instant USDC payments on Polygon.
 *
 * Authorization model:
 *   - Each cold wallet designates exactly ONE relayer (its hot faucet wallet).
 *   - The cold wallet signs an EIP-712 "RegisterRelayer" message in MetaMask.
 *   - The relayer submits that signature on-chain via registerRelayer().
 *   - After registration, only coldWalletRelayer[coldWallet] can call
 *     activatePolicy() and executeTransfer() for that cold wallet.
 */
contract InstantPayment is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    EIP712Upgradeable
{
    using ECDSA for bytes32;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Policy {
        uint256 totalAmount;    // Max USDC spendable (6 decimals)
        uint256 consumedAmount; // USDC spent so far
        uint256 deadline;       // Unix timestamp — policy expiry
        bool    isActive;
    }

    // ─── EIP-712 ──────────────────────────────────────────────────────────────

    /// @dev "RegisterRelayer(address coldWallet,address relayer,uint256 deadline)"
    bytes32 public constant REGISTER_RELAYER_TYPEHASH = keccak256(
        "RegisterRelayer(address coldWallet,address relayer,uint256 deadline)"
    );

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20Permit public usdcToken;

    /// @dev coldWallet => authorized hot relayer (faucet wallet)
    mapping(address => address) public coldWalletRelayer;

    /// @dev transferId => executed
    mapping(bytes32 => bool) public transfers;

    /// @dev coldWallet => Policy
    mapping(address => Policy) public policies;

    // ─── Events ───────────────────────────────────────────────────────────────

    event RelayerRegistered(address indexed coldWallet, address indexed relayer);
    event PolicyActivated(address indexed coldWallet, uint256 totalAmount, uint256 deadline);
    event TransferExecuted(bytes32 indexed transferId, address indexed from, address indexed to, uint256 amount);
    event TransferFailed(bytes32 indexed transferId, string reason);
    event PolicyReset(address indexed coldWallet);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotAuthorizedRelayer(address caller, address coldWallet);
    error AlreadyExecuted(bytes32 transferId);
    error PolicyExpired(address coldWallet);
    error PolicyInactive(address coldWallet);
    error ExceedsPolicyLimit(uint256 requested, uint256 available);
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error ZeroAmount();
    error InvalidAddress();
    error SignatureExpired();
    error InvalidSignature();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /**
     * @dev Restricts a function to the registered relayer of a given cold wallet.
     */
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
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __EIP712_init("InstantPayment", "1");
        usdcToken = IERC20Permit(_usdcToken);
    }

    // ─── Relayer Registration ─────────────────────────────────────────────────

    /**
     * @notice Register an authorized relayer for a cold wallet.
     *         The cold wallet signs the EIP-712 message off-chain (MetaMask).
     *         Anyone can submit the signature on-chain (gas paid by relayer).
     *
     * @param coldWallet  Address of the cold wallet (signer)
     * @param relayer     Address of the hot relayer/faucet wallet
     * @param deadline    Unix timestamp after which the signature is invalid
     * @param signature   EIP-712 signature from coldWallet
     */
    function registerRelayer(
        address coldWallet,
        address relayer,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (coldWallet == address(0) || relayer == address(0)) revert InvalidAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 structHash = keccak256(abi.encode(
            REGISTER_RELAYER_TYPEHASH,
            coldWallet,
            relayer,
            deadline
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);

        if (signer != coldWallet) revert InvalidSignature();

        coldWalletRelayer[coldWallet] = relayer;
        emit RelayerRegistered(coldWallet, relayer);
    }

    /**
     * @notice Admin override: directly set a relayer without EIP-712.
     *         Use only for emergency recovery or testing.
     */
    function setRelayer(address coldWallet, address relayer) external onlyOwner {
        if (coldWallet == address(0)) revert InvalidAddress();
        coldWalletRelayer[coldWallet] = relayer;
        emit RelayerRegistered(coldWallet, relayer);
    }

    // ─── Policy Management ────────────────────────────────────────────────────

    /**
     * @notice Activate a spending policy for a cold wallet.
     *         Only callable by the registered relayer of that cold wallet.
     *
     * @param coldWallet    Address of the cold wallet (funder)
     * @param totalAmount   Max USDC spendable (6 decimals, e.g. 100e6 = 100 USDC)
     * @param deadline      Unix timestamp when the policy expires
     */
    function activatePolicy(
        address coldWallet,
        uint256 totalAmount,
        uint256 deadline
    ) external onlyRelayerOf(coldWallet) whenNotPaused {
        if (totalAmount == 0) revert ZeroAmount();
        require(deadline > block.timestamp, "Deadline must be in the future");

        policies[coldWallet] = Policy({
            totalAmount:    totalAmount,
            consumedAmount: 0,
            deadline:       deadline,
            isActive:       true
        });

        emit PolicyActivated(coldWallet, totalAmount, deadline);
    }

    /**
     * @notice Reset (deactivate) a policy.
     *         Callable by the cold wallet's registered relayer OR by the owner.
     */
    function resetPolicy(address coldWallet) external {
        require(
            msg.sender == coldWalletRelayer[coldWallet] || msg.sender == owner(),
            "Not authorized"
        );
        policies[coldWallet].isActive = false;
        emit PolicyReset(coldWallet);
    }

    // ─── Transfer Execution ───────────────────────────────────────────────────

    /**
     * @notice Execute a single USDC transfer.
     *         Only the registered relayer of the `from` cold wallet may call this.
     *
     * @param transferId Unique identifier for idempotency (bytes32 from UUID)
     * @param from       Cold wallet address (policy owner, has given allowance)
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

        // ── Policy validation ─────────────────────────────────────────────
        Policy storage policy = policies[from];
        if (!policy.isActive)                      revert PolicyInactive(from);
        if (block.timestamp > policy.deadline)     revert PolicyExpired(from);
        if (amount == 0)                           revert ZeroAmount();
        if (to == address(0))                      revert InvalidAddress();

        uint256 available = policy.totalAmount - policy.consumedAmount;
        if (amount > available) revert ExceedsPolicyLimit(amount, available);

        // ── Allowance check ───────────────────────────────────────────────
        uint256 currentAllowance = usdcToken.allowance(from, address(this));
        if (currentAllowance < amount) revert InsufficientAllowance(currentAllowance, amount);

        // ── Mark executed BEFORE external call ────────────────────────────
        transfers[transferId] = true;
        policy.consumedAmount += amount;

        // ── Execute ───────────────────────────────────────────────────────
        bool success = usdcToken.transferFrom(from, to, amount);
        if (!success) {
            transfers[transferId] = false;
            policy.consumedAmount -= amount;
            emit TransferFailed(transferId, "USDC transferFrom returned false");
            return;
        }

        emit TransferExecuted(transferId, from, to, amount);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function isTransferExecuted(bytes32 transferId) external view returns (bool) {
        return transfers[transferId];
    }

    function getPolicyBalance(address coldWallet)
        external
        view
        returns (
            uint256 totalAmount,
            uint256 consumedAmount,
            uint256 remaining,
            uint256 deadline,
            bool    isActive,
            bool    isExpired
        )
    {
        Policy storage p = policies[coldWallet];
        totalAmount    = p.totalAmount;
        consumedAmount = p.consumedAmount;
        remaining      = p.totalAmount > p.consumedAmount ? p.totalAmount - p.consumedAmount : 0;
        deadline       = p.deadline;
        isActive       = p.isActive;
        isExpired      = block.timestamp > p.deadline;
    }

    /**
     * @notice Returns the EIP-712 domain separator (useful for frontend signing)
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── UUPS ─────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
