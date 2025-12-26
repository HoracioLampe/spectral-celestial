// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BatchDistributor
 * @notice Distributes USDC batches using Merkle Proofs and EIP-2612 Permits.
 * @dev Optimized for gas efficiency and security (ReentrancyGuard, Leaf Mapping).
 */
contract BatchDistributor is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // --- State Variables ---

    // The USDC Token Address on Polygon
    IERC20 public immutable usdcToken;
    IERC20Permit public immutable usdcPermit;

    // Mapping: Batch ID => Merkle Root
    mapping(uint256 => bytes32) public batchRoots;

    // Mapping: Leaf Hash => Boolean (True if executed)
    // Prevents Double Spending / Replay Attacks
    mapping(bytes32 => bool) public processedLeaves;

    // --- Events ---

    event BatchRootSet(uint256 indexed batchId, bytes32 merkleRoot);
    
    event TransactionExecuted(
        uint256 indexed batchId,
        uint256 indexed txId,
        address indexed recipient,
        address funder,
        uint256 amount,
        bytes32 leafHash
    );

    event FundsRescued(address token, uint256 amount);

    // --- Constructor ---

    constructor(address _usdcToken) Ownable(msg.sender) {
        require(_usdcToken != address(0), "Invalid Token Address");
        usdcToken = IERC20(_usdcToken);
        usdcPermit = IERC20Permit(_usdcToken);
    }

    // --- Admin Functions ---

    /**
     * @notice Registers the Merkle Root for a specific batch.
     * @param batchId The unique ID of the batch.
     * @param merkleRoot The Merkle Root.
     */
    function setBatchRoot(uint256 batchId, bytes32 merkleRoot) external onlyOwner {
        require(merkleRoot != bytes32(0), "Invalid Root");
        require(batchRoots[batchId] == bytes32(0), "Root already set");
        batchRoots[batchId] = merkleRoot;
        emit BatchRootSet(batchId, merkleRoot);
    }

    // --- Internal Logic ---

    /**
     * @notice Distributes MATIC to multiple addresses in a single transaction.
     * @dev Only used by the owner (Faucet) to fund relayers. 
     *      Added batch limit (500) to prevent block gas limit DOS.
     * @param recipients Array of relayers to fund.
     * @param amount Amount of MATIC (in wei) per relayer.
     */
    function distributeMatic(address[] calldata recipients, uint256 amount) external payable onlyOwner nonReentrant whenNotPaused {
        require(recipients.length <= 500, "Batch size too large (max 500)");
        require(msg.value >= recipients.length * amount, "Insufficient MATIC sent");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];
            if (recipient != address(0)) {
                (bool success, ) = recipient.call{value: amount}("");
                require(success, "MATIC transfer failed");
            }
        }
    }

    /**
     * @notice Executes a transaction with a Permit signature in a single call.
     * @dev Includes logic to check current allowance before calling permit to save gas.
     */
    function executeWithPermit(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount,
        bytes32[] calldata proof,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // 1. Submit Permit (Atomic Allowance) 
        // Optimization: only permit if needed (handles multiple relayers sending same funder permit)
        if (usdcToken.allowance(funder, address(this)) < amount) {
            try usdcPermit.permit(funder, address(this), amount, deadline, v, r, s) {} catch {}
        }

        // 2. Call internal execution logic
        _execute(batchId, txId, funder, recipient, amount, proof);
    }

    /**
     * @notice Executes a specific transaction from a batch.
     */
    function executeTransaction(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant whenNotPaused {
        _execute(batchId, txId, funder, recipient, amount, proof);
    }

    /**
     * @dev Internal execution logic with hardened security.
     */
    function _execute(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount,
        bytes32[] calldata proof
    ) internal {
        // HARDENED LEAF CALCULATION (Safe Hashing):
        // abi.encode is preferred over encodePacked for Merkle leaves to prevent collisions
        bytes32 leaf = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                batchId, 
                txId, 
                funder, 
                recipient, 
                amount
            )
        );

        // 2. Verify Idempotency
        require(!processedLeaves[leaf], "Tx already executed");

        // 3. Retrieve Root
        bytes32 root = batchRoots[batchId];
        require(root != bytes32(0), "Batch Root not set");

        // 4. Verify Merkle Proof
        require(MerkleProof.verify(proof, root, leaf), "Invalid Merkle Proof");

        // 5. Mark as Processed
        processedLeaves[leaf] = true;

        // 6. Transfer Funds
        require(amount > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");
        usdcToken.safeTransferFrom(funder, recipient, amount);

        // 7. Emit Event
        emit TransactionExecuted(batchId, txId, recipient, funder, amount, leaf);
    }

    // --- Emergency / Utility ---

    /**
     * @notice Withdraws all MATIC from the contract to the owner.
     */
    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No MATIC to withdraw");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "Withdraw failed");
        emit FundsRescued(address(0), balance);
    }

    /**
     * @notice Rescues ERC20 tokens sent to the contract by mistake.
     */
    function rescueTokens(address tokenAddress) external onlyOwner nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No funds");
        token.safeTransfer(owner(), balance);
        emit FundsRescued(tokenAddress, balance);
    }

    // --- Pausable Controls ---

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Verification Helper updated for new Leaf format (abi.encode)
    function generateLeafHash(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount
    ) external view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                batchId, 
                txId, 
                funder, 
                recipient, 
                amount
            )
        );
    }
}
