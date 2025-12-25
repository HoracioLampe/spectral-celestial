// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Updated for OZ v5
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BatchDistributor
 * @notice Distributes USDC batches using Merkle Proofs and EIP-2612 Permits.
 * @dev Optimized for gas efficiency and security (ReentrancyGuard, Leaf Mapping).
 */
contract BatchDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---

    // The USDC Token Address on Polygon
    IERC20 public immutable usdcToken;

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
    }

    // --- Admin Functions ---

    /**
     * @notice Registers the Merkle Root for a specific batch.
     * @dev Only Owner/Admin can call this. Ideally called via Gnosis Safe.
     * @param batchId The unique ID of the batch.
     * @param merkleRoot The calculated Merkle Root of the batch transactions.
     */
    function setBatchRoot(uint256 batchId, bytes32 merkleRoot) external onlyOwner {
        require(merkleRoot != bytes32(0), "Invalid Root");
        require(batchRoots[batchId] == bytes32(0), "Root already set"); // Immutable once set for safety
        
        batchRoots[batchId] = merkleRoot;
        emit BatchRootSet(batchId, merkleRoot);
    }

    // --- Core Logic ---

    /**
     * @notice Executes a specific transaction from a batch.
     * @dev Verifies the Merkle Proof and transfers funds from Funder to Recipient.
     *      Requires Funder to have given allowance to this contract via Permit or Approve.
     * @param batchId The Batch ID.
     * @param txId The unique Transaction ID within the batch.
     * @param funder The wallet providing the funds.
     * @param recipient The wallet receiving funds.
     * @param amount The amount of USDC (6 decimals) to transfer.
     * @param proof The Merkle Proof (sibling hashes).
     */
    function executeTransaction(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        // 1. Recreate the Leaf Hash
        // Must match exactly the JS implementation: 
        // ethers.utils.solidityKeccak256(['uint256','uint256','address','address','uint256'], ...)
        bytes32 leaf = keccak256(abi.encodePacked(batchId, txId, funder, recipient, amount));

        // 2. Verify Idempotency (Anti-Replay)
        require(!processedLeaves[leaf], "Tx already executed");

        // 3. Retrieve Root
        bytes32 root = batchRoots[batchId];
        require(root != bytes32(0), "Batch Root not set");

        // 4. Verify Merkle Proof
        require(MerkleProof.verify(proof, root, leaf), "Invalid Merkle Proof");

        // 5. Mark as Processed (Effect)
        processedLeaves[leaf] = true;

        // 6. Transfer Funds (Interaction)
        // Uses SafeERC20 to handle non-standard returns
        // The Funder must have `permitted` or `approved` this contract beforehand.
        usdcToken.safeTransferFrom(funder, recipient, amount);

        // 7. Emit Event for Indexers
        emit TransactionExecuted(batchId, txId, recipient, funder, amount, leaf);
    }

    // --- Emergency / Utility ---

    /**
     * @notice Rescues accidental tokens sent to this contract.
     */
    function rescueFunds(address tokenAddress) external onlyOwner {
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No funds");
        token.safeTransfer(msg.sender, balance);
        emit FundsRescued(tokenAddress, balance);
    }

    // --- Verification Helpers (For Debugging JS Consistency) ---

    /**
     * @notice Pure function to recreate the leaf hash exactly as Solidity does it.
     * @dev Use this to compare against your `server.js` console.log output.
     */
    function generateLeafHash(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(batchId, txId, funder, recipient, amount));
    }

    /**
     * @notice Validates a proof against a given root without executing anything.
     * @return isValid True if the proof matches the root.
     */
    function verifyProof(
        bytes32 root,
        bytes32[] calldata proof,
        bytes32 leaf
    ) external pure returns (bool isValid) {
        return MerkleProof.verify(proof, root, leaf);
    }
}
