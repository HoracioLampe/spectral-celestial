// Deployment Trigger: 2026-01-01 15:30
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const ethers = require('ethers');
const multer = require('multer');
const xlsx = require('xlsx');
const RelayerEngine = require('./services/relayerEngine');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const os = require('os');

// Multer for Excel Uploads - Use system temp dir for Railway compatibility
const upload = multer({ dest: os.tmpdir() });

// --- API Endpoints ---

// Get Public Transactions History (Home)
app.get('/api/transactions', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', async (req, res) => {
    try {
        const { tx_hash, from_address, to_address, amount, gas_used } = req.body;
        const result = await pool.query(
            'INSERT INTO transactions (tx_hash, from_address, to_address, amount, gas_used) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [tx_hash, from_address, to_address, amount, gas_used]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all batches
app.get('/api/batches', async (req, res) => {
    try {
        // Dynamic count of completed transactions for the list view
        const result = await pool.query(`
            SELECT b.*, 
            (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = b.id AND status = 'COMPLETED') as sent_transactions,
            (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = b.id) as total_transactions
            FROM batches b 
            ORDER BY b.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get batch details + transactions
app.get('/api/batches/:id', async (req, res) => {
    try {
        const batchId = req.params.id;
        const batchRes = await pool.query(`
            SELECT b.*, 
            (SELECT COUNT(*) FROM batch_transactions WHERE batch_id = b.id AND status = 'COMPLETED') as completed_count
            FROM batches b 
            WHERE b.id = $1
        `, [batchId]);
        const txRes = await pool.query('SELECT * FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);

        if (batchRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });

        res.json({
            batch: batchRes.rows[0],
            transactions: txRes.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new batch
app.post('/api/batches', async (req, res) => {
    try {
        const { batch_number, detail, description } = req.body;
        const result = await pool.query(
            'INSERT INTO batches (batch_number, detail, description, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [batch_number, detail, description, 'PREPARING']
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload Excel & Calculate Totals
app.post('/api/batches/:id/upload', upload.single('file'), async (req, res) => {
    const client = await pool.connect();
    try {
        const batchId = req.params.id;
        const filePath = req.file.path;

        // Create batch id log
        console.log(`[UPLOAD] Starting for Batch ID: ${batchId}`);
        console.log(`[UPLOAD] Reading file: ${filePath}`);

        let workbook;
        try {
            workbook = xlsx.readFile(filePath);
        } catch (readErr) {
            console.error("[UPLOAD] Error reading file:", readErr);
            throw new Error("Failed to parse Excel file");
        }

        const sheetName = workbook.SheetNames[0];
        console.log(`[UPLOAD] Sheet Name: ${sheetName}`);

        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        console.log(`[UPLOAD] Rows found: ${data.length}`);

        if (data.length > 0) {
            console.log("[UPLOAD] First row keys:", Object.keys(data[0]));
            console.log("[UPLOAD] First row sample:", JSON.stringify(data[0]));
        }

        await client.query('BEGIN');

        // CLEAR OLD TRANSACTIONS (Fix for "Reset" issue) - MOVED TO START
        await client.query('DELETE FROM batch_transactions WHERE batch_id = $1', [batchId]);

        let totalUSDC = 0n;
        let validTxs = 0;
        let loopIndex = 0;

        for (const rawRow of data) {
            loopIndex++;

            // Normalize keys to lowercase
            const row = {};
            Object.keys(rawRow).forEach(k => {
                row[k.toLowerCase().trim()] = rawRow[k];
            });

            const wallet = row['wallet'] || row['address'] || row['recipient'] || row['to'] || row['address wallet'];
            const amount = row['amount'] || row['usdc'] || row['value'];
            const ref = row['reference'] || row['ref'] || row['transactionid'];

            if (loopIndex <= 3) {
                console.log(`[UPLOAD] Processing Row ${loopIndex}: Wallet=${wallet}, Amount=${amount}`);
            }

            if (wallet && amount) {
                // Remove spaces and validate address
                const cleanWallet = wallet.toString().trim().toLowerCase();
                let cleanAmount = amount;

                // Handle comma decimals if present
                if (typeof amount === 'string') {
                    cleanAmount = amount.replace(',', '.');
                }

                if (ethers.isAddress(cleanWallet)) {
                    try {
                        // Standardize amount: Input is already in atomic units (6 decimals)
                        // i.e. 1000000 in Excel = 1 USDC.
                        const val = parseFloat(cleanAmount);
                        if (isNaN(val)) throw new Error("Invalid number");

                        const microAmount = BigInt(Math.floor(val));
                        totalUSDC += microAmount;
                        validTxs++;

                        await client.query(
                            'INSERT INTO batch_transactions (batch_id, wallet_address_to, amount_usdc, transaction_reference, status) VALUES ($1, $2, $3, $4, $5)',
                            [batchId, cleanWallet, microAmount.toString(), ref, 'PENDING']
                        );
                    } catch (rowErr) {
                        console.error(`[UPLOAD] Row ${loopIndex} Error:`, rowErr.message);
                    }
                } else {
                    console.warn(`[UPLOAD] Row ${loopIndex} Invalid Address: ${cleanWallet}`);
                }
            } else {
                console.warn(`[UPLOAD] Row ${loopIndex} Missing Data:`, row);
            }
        }

        console.log(`[UPLOAD] Finished Loop. ValidTxs: ${validTxs}`);

        if (validTxs === 0) {
            const foundKeys = data.length > 0 ? Object.keys(data[0]).join(', ') : "Ninguna (Archivo vacío)";
            throw new Error(`No se encontraron transacciones válidas. Columnas detectadas: [${foundKeys}]. Se busca: 'Wallet' y 'Amount'.`);
        }

        // Update Batch Totals and FULLY RESET status/stats for new file
        const updateRes = await client.query(
            `UPDATE batches SET 
                total_transactions = $1, 
                total_usdc = $2, 
                status = $3, 
                merkle_root = NULL, 
                funder_address = NULL,
                total_gas_used = NULL,
                execution_time = NULL,
                start_time = NULL,
                end_time = NULL,
                funding_amount = NULL,
                refund_amount = NULL
            WHERE id = $4 RETURNING *`,
            [validTxs, totalUSDC.toString(), 'READY', batchId]
        );
        console.log("[UPLOAD] Batch Updated successfully");

        await client.query('COMMIT');

        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (e) { console.error("Error deleting temp file:", e); }

        const txRes = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);

        res.json({
            batch: updateRes.rows[0],
            transactions: txRes.rows
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("[UPLOAD] Error:", err);
        // Clean up file on error too
        try {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } catch (e) { }

        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Generate Merkle Tree & Store Nodes
app.post('/api/batches/:id/merkle', async (req, res) => {
    const client = await pool.connect();
    try {
        const batchId = req.params.id;
        const { funder_address } = req.body;

        if (!ethers.isAddress(funder_address)) throw new Error("Invalid Funder Address");
        const normalizedFunder = funder_address.toLowerCase();

        const txRes = await client.query('SELECT id, wallet_address_to, amount_usdc FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
        const txs = txRes.rows;

        if (txs.length === 0) throw new Error("No transactions in batch");

        const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const { chainId } = await provider.getNetwork();
        const contractAddress = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";

        // 1. Generate Leaves
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const leaves = txs.map(tx => {
            const amountVal = BigInt(tx.amount_usdc);
            const encoded = abiCoder.encode(
                ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                [chainId, contractAddress, BigInt(batchId), BigInt(tx.id), normalizedFunder, tx.wallet_address_to, amountVal]
            );
            return {
                id: tx.id,
                hash: ethers.keccak256(encoded)
            };
        });

        await client.query('BEGIN');
        // Clear old Merkle nodes for this batch
        await client.query('DELETE FROM merkle_nodes WHERE batch_id = $1', [batchId]);

        // 2. Build Tree Level by Level
        let currentLevelNodes = leaves.map((l, idx) => ({
            batch_id: batchId,
            level: 0,
            position_index: idx,
            hash: l.hash,
            transaction_id: l.id
        }));

        // Persist Level 0
        for (const node of currentLevelNodes) {
            await client.query(
                'INSERT INTO merkle_nodes (batch_id, level, position_index, hash, transaction_id) VALUES ($1, $2, $3, $4, $5)',
                [node.batch_id, node.level, node.position_index, node.hash, node.transaction_id]
            );
        }

        let level = 0;
        while (currentLevelNodes.length > 1) {
            level++;
            const nextLevelNodes = [];

            for (let i = 0; i < currentLevelNodes.length; i += 2) {
                const left = currentLevelNodes[i];
                const right = (i + 1 < currentLevelNodes.length) ? currentLevelNodes[i + 1] : left;

                // SORTING SIBLINGS (v2.2.6 Corrected for Contract Compatibility)
                const [h1, h2] = [left.hash, right.hash];
                const [first, second] = BigInt(h1) < BigInt(h2) ? [h1, h2] : [h2, h1];

                const parentHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [first, second]);

                const parentNode = {
                    batch_id: batchId,
                    level: level,
                    position_index: Math.floor(i / 2),
                    hash: parentHash
                };

                await client.query(
                    'INSERT INTO merkle_nodes (batch_id, level, position_index, hash) VALUES ($1, $2, $3, $4)',
                    [parentNode.batch_id, parentNode.level, parentNode.position_index, parentNode.hash]
                );

                // LINK CHILDREN TO PARENT
                await client.query(
                    'UPDATE merkle_nodes SET parent_hash = $1 WHERE batch_id = $2 AND hash = $3',
                    [parentNode.hash, batchId, left.hash]
                );

                if (right.hash !== left.hash) { // Avoid double update if self-paired (rare in this logic but possible)
                    await client.query(
                        'UPDATE merkle_nodes SET parent_hash = $1 WHERE batch_id = $2 AND hash = $3',
                        [parentNode.hash, batchId, right.hash]
                    );
                }

                nextLevelNodes.push(parentNode);
            }
            currentLevelNodes = nextLevelNodes;
        }

        const root = currentLevelNodes[0].hash;

        // 3. Finalize Batch
        await client.query('UPDATE batches SET merkle_root = $1, funder_address = $2 WHERE id = $3', [root, normalizedFunder, batchId]);

        await client.query('COMMIT');
        res.json({ root });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET Faucet Helper (internal)
async function getFaucetCredentials() {
    const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
    let faucetPk = process.env.FAUCET_PRIVATE_KEY;
    if (faucetRes.rows.length > 0) {
        faucetPk = faucetRes.rows[0].private_key;
    }
    if (!faucetPk) {
        throw new Error("No Faucet configured. Generate one in Faucet Management.");
    }
    return faucetPk;
}

// Phase 1: Setup & Fund Relayers
app.post('/api/batches/:id/setup', async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const { relayerCount } = req.body;
        const safeRelayerCount = relayerCount || 5;
        if (safeRelayerCount > 100) {
            throw new Error("Maximum Relayer limit is 100 (Safe). 1000 causes Block Gas Limit errors.");
        }

        const faucetPk = await getFaucetCredentials();
        const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const engine = new RelayerEngine(pool, providerUrl, faucetPk);

        const result = await engine.prepareRelayers(batchId, safeRelayerCount);
        res.json({ message: "Relayers created and funded", count: result.count });
    } catch (err) {
        console.error("[Setup] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Phase 2: Start Execution (Swarm)
app.post('/api/batches/:id/execute', async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const { permitData, rootSignatureData } = req.body;

        const faucetPk = await getFaucetCredentials();
        const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const engine = new RelayerEngine(pool, providerUrl, faucetPk);

        const result = await engine.startExecution(batchId, permitData, rootSignatureData);
        res.json(result);
    } catch (err) {
        console.error("[Execute] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Keep /process alias for backwards compatibility or rename it
app.post('/api/batches/:id/process', async (req, res) => {
    // Redirecting legacy calls to execute
    try {
        const batchId = parseInt(req.params.id);
        const faucetPk = await getFaucetCredentials();
        const engine = new RelayerEngine(pool, process.env.PROVIDER_URL, faucetPk);
        const result = await engine.startExecution(batchId, req.body.permitData, req.body.rootSignatureData);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



const QUICKNODE_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

// Faucet Management API
app.get('/api/faucet', async (req, res) => {
    try {
        // 1. Check existing faucet in DB
        const result = await pool.query('SELECT * FROM faucets LIMIT 1');

        if (result.rows.length > 0) {
            const row = result.rows[0];
            const rpcUrl = process.env.RPC_URL || QUICKNODE_URL;
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const balance = await provider.getBalance(row.address);
            res.json({
                address: row.address,
                privateKey: row.private_key,
                balance: ethers.formatEther(balance)
            });
        } else {
            // AUTO-GENERATE if missing (Security Rotation)
            console.log("🔍 No Faucet found, generating new one...");
            const wallet = ethers.Wallet.createRandom();
            await pool.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, wallet.privateKey]);
            res.json({
                address: wallet.address,
                privateKey: wallet.privateKey,
                balance: '0'
            });
        }
    } catch (err) {
        console.error("Error fetching faucet:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/faucet/generate', async (req, res) => {
    try {
        const wallet = ethers.Wallet.createRandom();

        await pool.query('DELETE FROM faucets'); // Ensure only one exists
        await pool.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, wallet.privateKey]);

        res.json({ address: wallet.address });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs', async (req, res) => {
    res.json({ message: "Logs are available in the console" });
});

app.get('/api/config', (req, res) => {
    res.json({
        RPC_URL: process.env.RPC_URL || QUICKNODE_URL,
        WS_RPC_URL: process.env.WS_RPC_URL || "",
        CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5"
    });
});

// --- Helper for Merkle Proof ---
async function getMerkleProof(client, batchId, transactionId) {
    const startRes = await client.query(
        `SELECT position_index, hash FROM merkle_nodes WHERE batch_id = $1 AND level = 0 AND transaction_id = $2`,
        [batchId, transactionId]
    );
    if (startRes.rows.length === 0) throw new Error("Transaction leaf not found");

    const maxLevelRes = await client.query(
        `SELECT MAX(level) as max_level FROM merkle_nodes WHERE batch_id = $1`,
        [batchId]
    );
    const maxLevel = maxLevelRes.rows[0].max_level;

    let currentIndex = startRes.rows[0].position_index;
    const proof = [];

    for (let level = 0; level < maxLevel; level++) {
        const siblingIndex = currentIndex ^ 1;
        const siblingRes = await client.query(
            `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
            [batchId, level, siblingIndex]
        );

        if (siblingRes.rows.length > 0) {
            proof.push(siblingRes.rows[0].hash);
        } else {
            // Self-pairing handling
            const currentRes = await client.query(
                `SELECT hash FROM merkle_nodes WHERE batch_id = $1 AND level = $2 AND position_index = $3`,
                [batchId, level, currentIndex]
            );
            if (currentRes.rows.length > 0) {
                proof.push(currentRes.rows[0].hash);
            }
        }
        currentIndex = currentIndex >> 1;
    }
    return proof;
}

// Get Merkle Proof for a Transaction
app.get('/api/batches/:batchId/transactions/:txId/proof', async (req, res) => {
    const client = await pool.connect();
    try {
        const batchId = req.params.batchId;
        const txId = req.params.txId;
        const proof = await getMerkleProof(client, batchId, txId);
        res.json({ proof });
    } catch (err) {
        console.error("Proof Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Fallback para SPA moved to bottom


// Setup Endpoint for DB migrations
app.get('/api/setup', async (req, res) => {
    const client = await pool.connect();
    try {
        console.log("Running DB Setup v2.2.15...");

        // 1. Ensure updated_at exists
        await client.query(`
            ALTER TABLE batches
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
        `);

        // 2. Diagnostics: List columns
        const colRes = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'batches'
        `);
        const columns = colRes.rows.map(r => r.column_name);

        res.json({
            version: "2.2.15",
            message: "Database setup diagnostic completed.",
            columns_found: columns,
            success: columns.includes('updated_at')
        });
    } catch (err) {
        console.error("Setup Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 8. Get Transactions for a Batch (Server-Side Pagination & Filtering)
app.get('/api/batches/:id/transactions', async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const { page = 1, limit = 10, wallet, amount, status } = req.query;
        const offset = (page - 1) * limit;

        // Build Dynamic Query
        let query = `SELECT * FROM batch_transactions WHERE batch_id = $1`;
        let countQuery = `SELECT count(*) FROM batch_transactions WHERE batch_id = $1`;
        const params = [batchId];
        let paramIdx = 2;

        if (wallet) {
            query += ` AND wallet_address_to ILIKE $${paramIdx}`;
            countQuery += ` AND wallet_address_to ILIKE $${paramIdx}`;
            params.push(`%${wallet}%`); // Partial match
            paramIdx++;
        }

        if (status) {
            query += ` AND status = $${paramIdx}`;
            countQuery += ` AND status = $${paramIdx}`;
            params.push(status);
            paramIdx++;
        }

        if (amount) {
            // Amount in database is microUSDC (integer). Input is USDC (float).
            const amountMicro = Math.round(parseFloat(amount) * 1000000);
            query += ` AND amount_usdc = $${paramIdx}`;
            countQuery += ` AND amount_usdc = $${paramIdx}`;
            params.push(amountMicro);
            paramIdx++;
        }

        // Add sorting and pagination
        query += ` ORDER BY id ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

        // Execute Queries
        const totalRes = await pool.query(countQuery, params.slice(0, paramIdx - 1)); // Exclude limit/offset params
        const totalItems = parseInt(totalRes.rows[0].count);

        const dataRes = await pool.query(query, [...params, limit, offset]);

        res.json({
            transactions: dataRes.rows,
            total: totalItems,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(totalItems / limit)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 9. Get Relayers for a Batch (Live Balance Sync)
app.get('/api/relayers/:batchId', async (req, res) => {
    try {
        const batchId = parseInt(req.params.batchId);
        // Fetch relayers from DB
        // Fetch relayers from DB with Transaction Count
        const result = await pool.query(`
            SELECT 
                r.id, r.address, r.private_key, r.status, r.last_activity, r.transactionhash_deposit, r.last_balance as db_balance,
                (SELECT COUNT(*)::int FROM batch_transactions bt WHERE bt.relayer_address = r.address AND bt.batch_id = r.batch_id AND bt.tx_hash IS NOT NULL) as tx_count
            FROM relayers r 
            WHERE r.batch_id = $1
            ORDER BY r.id ASC
        `, [batchId]);

        const relayers = result.rows;

        // Parallel Live Balance Check
        const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const provider = new ethers.JsonRpcProvider(providerUrl);

        const updatedRelayers = await Promise.all(relayers.map(async (r) => {
            try {
                // Fetch live balance
                const balWei = await provider.getBalance(r.address);
                const balFormatted = ethers.formatEther(balWei);

                // Update DB async (fire and forget)
                pool.query('UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE id = $2', [balFormatted, r.id]).catch(console.error);

                return {
                    ...r,
                    balance: balFormatted, // Override with live data
                    private_key: undefined // Don't leak PK
                };
            } catch (e) {
                console.warn(`Failed to sync balance for ${r.address}:`, e.message);
                return { ...r, balance: r.db_balance || "0", private_key: undefined };
            }
        }));

        res.json(updatedRelayers);
    } catch (err) {
        console.error("Error fetching relayers:", err);
        res.status(500).json({ error: err.message });
    }
});


// Fallback para SPA (Al final de todo)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Manual Fund Recovery Endpoint
app.post('/api/batches/:id/return-funds', async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const faucetPk = await getFaucetCredentials();
        const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const engine = new RelayerEngine(pool, providerUrl, faucetPk);

        // Call the method physically (assuming updated RelayerEngine exposes it)
        const recovered = await engine.returnFundsToFaucet(batchId);
        res.json({ success: true, message: `Recovery process completed. Recovered: ${recovered || 0} MATIC` });
    } catch (err) {
        console.error("[Refund] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

const VERSION = "2.3.0";
const PORT_LISTEN = process.env.PORT || 3000;

app.listen(PORT_LISTEN, () => {
    console.log(`Server is running on port ${PORT_LISTEN}`);
    console.log(`🚀 Version: ${VERSION} (Self-Healing & Performance Record)`);
});



