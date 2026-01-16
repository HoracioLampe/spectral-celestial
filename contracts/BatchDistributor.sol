// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// --- Interfaces ---

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

/**
 * @title BatchDistributor
 * @notice Distribuidor de pagos descentralizado y seguro con soporte EIP-712.
 */
contract BatchDistributor {
    
    // --- EIP-712 ---
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant SET_BATCH_ROOT_TYPEHASH = keccak256("SetBatchRoot(address funder,uint256 batchId,bytes32 merkleRoot,uint256 totalTransactions,uint256 totalAmount,uint256 nonce)");
    bytes32 public constant SET_BATCH_PAUSE_TYPEHASH = keccak256("SetBatchPause(address funder,uint256 batchId,bool paused,uint256 nonce)");

    // --- Estado ---
    IERC20 public immutable usdcToken;
    IERC20Permit public immutable usdcPermit;

    mapping(address => mapping(uint256 => bytes32)) public batchRoots;
    mapping(address => mapping(uint256 => bool)) public batchPaused;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public processedLeaves;

    event BatchRootSet(address indexed funder, uint256 indexed batchId, bytes32 merkleRoot);
    event BatchPauseSet(address indexed funder, uint256 indexed batchId, bool paused);
    event TransactionExecuted(uint256 indexed batchId, uint256 indexed txId, address indexed recipient, address funder, uint256 amount);

    constructor() {
        // USDC Native en Polygon
        address _usdcToken = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
        usdcToken = IERC20(_usdcToken);
        usdcPermit = IERC20Permit(_usdcToken);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("BatchDistributor")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // --- Gestión de Lotes ---
    
    function setBatchRoot(uint256 batchId, bytes32 merkleRoot) external {
        require(merkleRoot != bytes32(0), "Root invalida");
        require(batchRoots[msg.sender][batchId] == bytes32(0), "Root ya existe");
        batchRoots[msg.sender][batchId] = merkleRoot;
        emit BatchRootSet(msg.sender, batchId, merkleRoot);
    }

    function setBatchPause(uint256 batchId, bool paused) external {
        batchPaused[msg.sender][batchId] = paused;
        emit BatchPauseSet(msg.sender, batchId, paused);
    }

    // --- Funciones Gasless (Firmas EIP-712) ---

    function setBatchRootWithSignature(
        address funder, 
        uint256 batchId, 
        bytes32 merkleRoot, 
        uint256 totalTransactions, 
        uint256 totalAmount, 
        bytes calldata signature
    ) external {
        require(batchRoots[funder][batchId] == bytes32(0), "Root ya existe");
        
        bytes32 structHash = keccak256(abi.encode(
            SET_BATCH_ROOT_TYPEHASH,
            funder,
            batchId,
            merkleRoot,
            totalTransactions,
            totalAmount,
            nonces[funder]++
        ));

        bytes32 hash = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        require(recover(hash, signature) == funder, "Firma invalida");

        batchRoots[funder][batchId] = merkleRoot;
        emit BatchRootSet(funder, batchId, merkleRoot);
    }

    function setBatchPauseWithSignature(
        address funder, 
        uint256 batchId, 
        bool paused, 
        bytes calldata signature
    ) external {
        bytes32 structHash = keccak256(abi.encode(
            SET_BATCH_PAUSE_TYPEHASH,
            funder,
            batchId,
            paused,
            nonces[funder]++
        ));

        bytes32 hash = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        require(recover(hash, signature) == funder, "Firma invalida");

        batchPaused[funder][batchId] = paused;
        emit BatchPauseSet(funder, batchId, paused);
    }

    // --- Ejecución ---

    function executeWithPermit(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (usdcToken.allowance(funder, address(this)) < amount) {
            try usdcPermit.permit(funder, address(this), amount, deadline, v, r, s) {} catch {}
        }
        _execute(batchId, txId, funder, recipient, amount, proof);
    }

    function executeTransaction(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) external {
        _execute(batchId, txId, funder, recipient, amount, proof);
    }

    function _execute(uint256 batchId, uint256 txId, address funder, address recipient, uint256 amount, bytes32[] calldata proof) internal {
        require(!batchPaused[funder][batchId], "Lote pausado");
        bytes32 leaf = keccak256(abi.encode(block.chainid, address(this), batchId, txId, funder, recipient, amount));
        require(!processedLeaves[leaf], "Ya procesado");
        require(verifyMerkle(proof, batchRoots[funder][batchId], leaf), "Prueba Merkle invalida");

        processedLeaves[leaf] = true;
        require(usdcToken.transferFrom(funder, recipient, amount), "USDC transfer failed");
        emit TransactionExecuted(batchId, txId, recipient, funder, amount);
    }

    // --- Utilidades ---

    function verifyMerkle(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }

    /**
     * @notice Helper para validar pruebas off-chain sin gastar gas (llamada readonly).
     */
    function validateMerkleProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) external pure returns (bool) {
        return verifyMerkle(proof, root, leaf);
    }

    /**
     * @notice Validación COMPLETA incluyendo la generación del Leaf on-chain.
     * Replica exactamente la logica de _execute para garantizar compatibilidad total.
     */
    function validateMerkleProofDetails(
        uint256 batchId,
        uint256 txId,
        address funder,
        address recipient,
        uint256 amount,
        bytes32 root,
        bytes32[] calldata proof
    ) external view returns (bool) {
        // Replicamos la generacion de la hoja EXACTAMENTE como en _execute
        bytes32 leaf = keccak256(abi.encode(block.chainid, address(this), batchId, txId, funder, recipient, amount));
        return verifyMerkle(proof, root, leaf);
    }

    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }

    function distributeMatic(address[] calldata recipients, uint256 amount) external payable {
        require(msg.value >= recipients.length * amount, "Saldo insuficiente");
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i] != address(0)) {
                (bool success, ) = recipients[i].call{value: amount}("");
                require(success, "Transfer failed");
            }
        }
    }
}