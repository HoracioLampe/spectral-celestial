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
        const result = await pool.query('SELECT * FROM batches ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get batch details + transactions
app.get('/api/batches/:id', async (req, res) => {
    try {
        const batchId = req.params.id;
        const batchRes = await pool.query('SELECT * FROM batches WHERE id = $1', [batchId]);
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
                const cleanWallet = wallet.toString().trim();
                let cleanAmount = amount;

                // Handle comma decimals if present
                if (typeof amount === 'string') {
                    cleanAmount = amount.replace(',', '.');
                }

                if (ethers.isAddress(cleanWallet)) {
                    try {
                        // Standardize amount to 6 decimals (microUSDC)
                        const val = parseFloat(cleanAmount);
                        if (isNaN(val)) throw new Error("Invalid number");

                        const microAmount = BigInt(Math.round(val * 1000000));
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

        // Update Batch Totals
        const updateRes = await client.query(
            'UPDATE batches SET total_transactions = $1, total_usdc = $2, status = $3 WHERE id = $4 RETURNING *',
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

        const txRes = await client.query('SELECT id, wallet_address_to, amount_usdc FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
        const txs = txRes.rows;

        if (txs.length === 0) throw new Error("No transactions in batch");

        const providerUrl = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const { chainId } = await provider.getNetwork();
        const contractAddress = process.env.CONTRACT_ADDRESS || "0x3D8A8ae7Bb507104C7928B6e856c348104bD7406";

        // 1. Generate Leaves
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const leaves = txs.map(tx => {
            const amountVal = BigInt(tx.amount_usdc);
            const encoded = abiCoder.encode(
                ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                [chainId, contractAddress, BigInt(batchId), BigInt(tx.id), funder_address, tx.wallet_address_to, amountVal]
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
                nextLevelNodes.push(parentNode);
            }
            currentLevelNodes = nextLevelNodes;
        }

        const root = currentLevelNodes[0].hash;

        // 3. Finalize Batch
        await client.query('UPDATE batches SET merkle_root = $1, funder_address = $2 WHERE id = $3', [root, funder_address, batchId]);

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

// Process Batch (Trigger Relayers)
app.post('/api/batches/:id/process', async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        if (isNaN(batchId)) return res.status(400).json({ error: 'Invalid batchId' });
        const { relayerCount, permitData, rootSignatureData } = req.body;

        // RELAXED IDEMPOTENCY: allow resumption if status is READY or PROCESSING
        const batchStatusRes = await pool.query('SELECT status FROM batches WHERE id = $1', [batchId]);
        const currentStatus = batchStatusRes.rows[0]?.status;

        if (currentStatus === 'SENT' || currentStatus === 'COMPLETED') {
            return res.status(400).json({ error: `Este lote ya terminó (Estado: ${currentStatus})` });
        }

        // Fetch Faucet from DB
        const faucetRes = await pool.query('SELECT private_key FROM faucets ORDER BY id DESC LIMIT 1');
        let faucetPk = process.env.FAUCET_PRIVATE_KEY;

        if (faucetRes.rows.length > 0) {
            faucetPk = faucetRes.rows[0].private_key;
        } else if (!faucetPk) {
            const wallet = ethers.Wallet.createRandom();
            faucetPk = wallet.privateKey;
            await pool.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, faucetPk]);
        }

        const providerUrl = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
        const engine = new RelayerEngine(pool, providerUrl, faucetPk);

        const setup = await engine.startBatchProcessing(batchId, relayerCount || 5, permitData, rootSignatureData);
        res.json({ message: "Relayers setup and processing started", batchId, relayers: setup.count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get relayer balances for a batch
app.get('/api/relayers/:batchId', async (req, res) => {
    try {
        const batchId = parseInt(req.params.batchId);
        const relayerRes = await pool.query('SELECT id, address, last_activity, last_balance, transactionhash_deposit FROM relayers WHERE batch_id = $1 ORDER BY id ASC', [batchId]);

        const balances = relayerRes.rows.map(r => ({
            id: r.id,
            address: r.address,
            balance: r.last_balance || "0",
            lastActivity: r.last_activity,
            transactionHashDeposit: r.transactionhash_deposit
        }));

        res.json(balances);
    } catch (err) {
        console.error('Error fetching relayer balances:', err);
        res.status(500).json({ error: err.message });
    }
});

// Faucet Management API
app.get('/api/faucet', async (req, res) => {
    try {
        // 1. Check existing faucet in DB
        const result = await pool.query('SELECT * FROM faucets LIMIT 1');

        if (result.rows.length > 0) {
            const row = result.rows[0];
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            const balance = await provider.getBalance(row.address);
            res.json({
                address: row.address,
                privateKey: row.private_key,
                balance: ethers.formatEther(balance)
            });
        } else {
            res.json({ address: null, balance: '0' });
        }
    } catch (err) {
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

// Fallback para SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

const VERSION = "2.2.24";
const PORT_LISTEN = process.env.PORT || 3000;

app.listen(PORT_LISTEN, () => {
    console.log(`Server is running on port ${PORT_LISTEN}`);
    console.log(`🚀 Version: ${VERSION} (Faucet Table Fix)`);
});
