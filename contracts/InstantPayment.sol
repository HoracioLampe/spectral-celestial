// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

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
 *      The cold wallet signs a permit() once per cycle. The contract
 *      validates each transfer against the active policy limits.
 */
contract InstantPayment is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ─── Types ────────────────────────────────────────────────────────────────

    struct Policy {
        uint256 totalAmount;    // Max USDC spendable (6 decimals)
        uint256 consumedAmount; // USDC spent so far
        uint256 deadline;       // Unix timestamp — policy expiry
        bool    isActive;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20Permit public usdcToken;

    /// @dev transferId => executed
    mapping(bytes32 => bool) public transfers;

    /// @dev coldWallet => Policy
    mapping(address => Policy) public policies;

    // ─── Events ───────────────────────────────────────────────────────────────

    event PolicyActivated(
        address indexed coldWallet,
        uint256 totalAmount,
        uint256 deadline
    );
    event TransferExecuted(
        bytes32 indexed transferId,
        address indexed from,
        address indexed to,
        uint256 amount
    );
    event TransferFailed(bytes32 indexed transferId, string reason);
    event PolicyReset(address indexed coldWallet);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error AlreadyExecuted(bytes32 transferId);
    error PolicyExpired(address coldWallet);
    error PolicyInactive(address coldWallet);
    error ExceedsPolicyLimit(uint256 requested, uint256 available);
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error ZeroAmount();
    error InvalidAddress();

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
        usdcToken = IERC20Permit(_usdcToken);
    }

    // ─── Policy Management ────────────────────────────────────────────────────

    /**
     * @notice Activate a spending policy for a cold wallet.
     *         Only callable by the owner/admin (relayer backend).
     * @param coldWallet    Address of the cold wallet (funder)
     * @param totalAmount   Max USDC spendable (6 decimals, e.g. 100e6 = 100 USDC)
     * @param deadline      Unix timestamp when the policy expires
     */
    function activatePolicy(
        address coldWallet,
        uint256 totalAmount,
        uint256 deadline
    ) external onlyOwner whenNotPaused {
        if (coldWallet == address(0)) revert InvalidAddress();
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
     * @notice Reset (deactivate) a policy for a cold wallet.
     */
    function resetPolicy(address coldWallet) external onlyOwner {
        policies[coldWallet].isActive = false;
        emit PolicyReset(coldWallet);
    }

    // ─── Transfer Execution ───────────────────────────────────────────────────

    /**
     * @notice Execute a single USDC transfer, validated against the active policy.
     * @param transferId Unique identifier for idempotency (bytes32 from UUID)
     * @param from       Cold wallet address (must have allowance to this contract)
     * @param to         Destination wallet
     * @param amount     USDC amount (6 decimals)
     */
    function executeTransfer(
        bytes32 transferId,
        address from,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant whenNotPaused {
        // ── Idempotency check ──────────────────────────────────────────────
        if (transfers[transferId]) revert AlreadyExecuted(transferId);

        // ── Policy validation ─────────────────────────────────────────────
        Policy storage policy = policies[from];
        if (!policy.isActive) revert PolicyInactive(from);
        if (block.timestamp > policy.deadline) revert PolicyExpired(from);
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert InvalidAddress();

        uint256 available = policy.totalAmount - policy.consumedAmount;
        if (amount > available) revert ExceedsPolicyLimit(amount, available);

        // ── Allowance check ───────────────────────────────────────────────
        uint256 currentAllowance = usdcToken.allowance(from, address(this));
        if (currentAllowance < amount) revert InsufficientAllowance(currentAllowance, amount);

        // ── Mark as executed BEFORE external call (reentrancy protection) ─
        transfers[transferId] = true;
        policy.consumedAmount += amount;

        // ── Execute ───────────────────────────────────────────────────────
        bool success = usdcToken.transferFrom(from, to, amount);
        if (!success) {
            // Rollback state on failure
            transfers[transferId] = false;
            policy.consumedAmount -= amount;
            emit TransferFailed(transferId, "USDC transferFrom returned false");
            return;
        }

        emit TransferExecuted(transferId, from, to, amount);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    /**
     * @notice Check if a transfer has already been executed.
     */
    function isTransferExecuted(bytes32 transferId) external view returns (bool) {
        return transfers[transferId];
    }

    /**
     * @notice Get the current policy balance for a cold wallet.
     */
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

    // ─── Admin Functions ──────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── UUPS ─────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}
}
