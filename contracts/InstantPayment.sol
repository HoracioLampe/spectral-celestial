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
    Ownable2StepUpgradeable,
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

    /// @dev Máximo USDC que puede configurarse en una policy (6 decimales). Default: 20.000 USDC
    uint256 public maxPolicyAmount;

    // ─── Events ───────────────────────────────────────────────────────────────

    event RelayerRegistered(address indexed coldWallet, address indexed relayer);
    event PolicyActivated(address indexed coldWallet, uint256 totalAmount, uint256 deadline);
    event TransferExecuted(bytes32 indexed transferId, address indexed from, address indexed to, uint256 amount);
    event PolicyReset(address indexed coldWallet);
    event MaxPolicyAmountUpdated(uint256 oldAmount, uint256 newAmount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotAuthorizedRelayer(address caller, address coldWallet);
    error NotAuthorizedToReset(address caller);
    error AlreadyExecuted(bytes32 transferId);
    error PolicyExpired(address coldWallet);
    error PolicyInactive(address coldWallet);
    error ExceedsPolicyLimit(uint256 requested, uint256 available);
    error ExceedsMaxPolicyAmount(uint256 requested, uint256 maxAllowed);
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error ZeroAmount();
    error InvalidAddress();
    error SignatureExpired();
    error InvalidSignature();
    error TransferFailed();

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
        if (_usdcToken == address(0)) revert InvalidAddress();
        __Ownable_init(_owner);
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __EIP712_init("InstantPayment", "1");
        usdcToken = IERC20Permit(_usdcToken);
        maxPolicyAmount = 20_000e6; // Default: 20.000 USDC (6 decimals)
    }

    // ─── Relayer Registration ─────────────────────────────────────────────────

    /**
     * @notice Register an authorized relayer for a cold wallet.
     *         The cold wallet signs the EIP-712 message off-chain (MetaMask).
     *         Anyone can submit the signature on-chain (gas paid by relayer).
     *         El nonce se incrementa solo si la TX tiene éxito. Si revierte,
     *         el relayer puede reintentar con la misma firma.
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

        // Leer nonce actual sin incrementar todavía
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

        // Consumir el nonce solo después de verificar la firma
        relayerNonces[coldWallet] = currentNonce + 1;

        coldWalletRelayer[coldWallet] = relayer;
        emit RelayerRegistered(coldWallet, relayer);
    }

    /**
     * @notice Retorna el nonce actual de registro de relayer para un cold wallet.
     *         El frontend debe leer este valor antes de generar la firma EIP-712.
     */
    function getRelayerNonce(address coldWallet) external view returns (uint256) {
        return relayerNonces[coldWallet];
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
        if (totalAmount > maxPolicyAmount) revert ExceedsMaxPolicyAmount(totalAmount, maxPolicyAmount);
        if (deadline <= block.timestamp) revert PolicyExpired(coldWallet);

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
        if (msg.sender != coldWallet &&
            msg.sender != coldWalletRelayer[coldWallet] &&
            msg.sender != owner()) {
            revert NotAuthorizedToReset(msg.sender);
        }
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
        // Si transferFrom falla, la EVM revierte TODO automáticamente (CEI pattern)
        if (!usdcToken.transferFrom(from, to, amount)) revert TransferFailed();

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

    /**
     * @notice Actualiza el monto máximo permitido en una policy.
     *         El frontend debe leer este valor para limitar el input del usuario.
     * @param newMax Nuevo límite en USDC (6 decimales). Ejemplo: 50_000e6 = 50.000 USDC
     */
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
    // Reservar slots para futuras variables de estado en upgrades.
    // Reducir __gap en 1 por cada nueva variable de estado que se agregue en V2+.
    // Ref: sharp_edges.md#storage-collision
    uint256[44] private __gap;
}
