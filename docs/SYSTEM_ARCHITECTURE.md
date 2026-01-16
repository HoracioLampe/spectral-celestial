# System Architecture

## 1. Merkle Tree Implementation

### Structure
The Merkle Tree is used to compress thousands of payment transactions into a single 32-byte `Merkle Root` stored on-chain. This allows for gas-efficient processing.

### Leaf Generation
Each leaf in the tree represents a secure, unique hash of a transaction.
**Formula:**
```solidity
keccak256(abi.encode(
    uint256 chainId,
    address contractAddress,
    uint256 batchId,
    uint256 txId,        // Database Unique ID
    address funder,
    address recipient,
    uint256 amount
));
```
*Note: We use `txId` (DB ID) instead of the excel reference string to ensure strictly unique, monotonically increasing identifiers.*

### 3. Security: Anatomy of the Unique Hash
The combination of these 7 fields guarantees that **no transaction can ever be replayed** in a different context.

| Field | Purpose | Security Protection |
| :--- | :--- | :--- |
| `block.chainid` | Polygon Chain ID (137) | **Cross-Chain Replay Protection**.<br>Prevents a signed proof from being used on Ethereum Mainnet or testnets. |
| `address(this)` | Contract Address | **Cross-Contract Replay Protection**.<br>Prevents a proof from being used on a different deployment of the BatchDistributor. |
| `batchId` | **Batch / Lot ID** | **Batch Isolation**.<br>Ensures a payment to "Alice for 10 USDC" in Batch 1 cannot be re-used in Batch 2. |
| `txId` | Unique DB ID | **Duplicate Entry Protection**.<br>Allows sending TWO identical payments to Alice in the *same* batch (e.g., salary + bonus). They will have different `txId`s (101, 102), generating different hashes. |
| `amount` | USDC Amount | **Integrity**.<br>Prevents tampering with the value. |
| `recipient` | Wallet Address | **Integrity**.<br>Prevents diverting funds. |
| `funder` | Source Wallet | **Authorization**.<br>Ensures funds are pulled from the correct approved wallet. |

> [!NOTE]
> **Why not "Block Number"?**
> We do *not* include the Blockchain Block Number because the Merkle Tree is generated **off-chain** before the transaction is mined. We cannot know the future block number. The `batchId` serves the purpose of temporal grouping.

### Tree Construction (Sorted Pairs)
To ensure determinstic root generation regardless of the order of operands:
1.  Hashes of a level are paired (left, right).
2.  **Sorting**: Before hashing the pair, the two hashes are sorted numerically (`Left < Right`).
3.  **Parent Hash**: `keccak256(packed(LowerHash, HigherHash))`.

---

## 2. Relayer System & Idempotency

### The Problem
Processing thousands of transactions requires multiple "Relayer" wallets to send transactions in parallel (High Throughput). However, if two relayers pick the same transaction, or if a relayer crashes after sending but before updating the DB, we risk double-spending or stuck transactions.

### The Solution: "Swarm" with Atomic Locks

#### A. Allocation (`SELECT ... FOR UPDATE SKIP LOCKED`)
We use Postgres's atomic locking mechanism.
-   When a worker requests a job, it executes a query that finds the next `PENDING` transaction.
-   `FOR UPDATE`: Locks the row.
-   `SKIP LOCKED`: If another worker has locked a row, skip it instantly (don't wait).
-   **Result**: Multiple relayers can hammer the queue simultaneously, and **Postgres guarantees** each transaction is handed to exactly one worker.

#### B. On-Chain Idempotency (`processedLeaves`)
Even with DB locks, a relayer could send a TX, crash, and not update the DB. The DB might reset the status later, causing another relayer to retry.
-   The Smart Contract maintains a mapping: `mapping(bytes32 => bool) public processedLeaves;`
-   The `leaf` hash (unique per tx) is marked `true` upon execution.
-   If a second attempt is made, the contract reverts with `"Ya procesado"`.
-   **Handling Refusal**: The Relayer Engine detects this specific revert ("Tx already executed") and marks the transaction as `COMPLETED` (Self-Healing).

#### C. Recovery of Stuck Transactions
If a relayer wallet runs out of gas or the node process dies:
1.  The transaction remains in `SENDING_RPC` state in the DB.
2.  After a timeout (e.g., 2 minutes), the `fetchStuckTx` function identifies these "stale locks".
3.  Any available worker can "steal" this transaction and retry it.
4.  If the original attempt actually succeeded (but just wasn't recorded), the retry will fail on-chain (Idempotency), and the system will simply mark it as done.
