const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const { ethers } = require('ethers');
const RelayerEngine = require('./services/relayerEngine');

const app = express();
// Build Trigger: 2025-12-25 16:04 (Force Sync)
const PORT = process.env.PORT || 3000;

// Configuración de Multer para subida de archivos
const upload = multer({ dest: 'uploads/' });

// Configuración de PostgreSQL
// Railway provee automáticamente la variable DATABASE_URL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Configuración Pública para el Frontend
app.get('/api/config', (req, res) => {
    res.json({
        RPC_URL: process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/",
        WS_RPC_URL: process.env.WS_PROVIDER_URL || "wss://polygon-rpc.com"
    });
});

// Inicializar base de datos
const initDB = async () => {
    try {
        if (!process.env.DATABASE_URL) {
            console.log("⚠️ DATABASE_URL no está definida (Probablemente en local). Saltando DB.");
            return;
        }
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(100),
                    apellido VARCHAR(100),
                    dni VARCHAR(20) UNIQUE,
                    edad INTEGER,
                    sexo VARCHAR(20),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS courses (
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(150),
                    descripcion TEXT,
                    nivel VARCHAR(50),
                    fecha_inicio DATE,
                    duracion_semanas INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id SERIAL PRIMARY KEY,
                    tx_hash VARCHAR(66) UNIQUE NOT NULL,
                    from_address VARCHAR(42) NOT NULL,
                    to_address VARCHAR(42) NOT NULL,
                    amount VARCHAR(50) NOT NULL,
                    gas_used VARCHAR(50),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            // Tablas para Gestión de Lotes (Refactored)
            await client.query(`
                CREATE TABLE IF NOT EXISTS batches (
                    id SERIAL PRIMARY KEY,
                    batch_number VARCHAR(50),
                    detail TEXT,
                    description TEXT,
                    total_usdc NUMERIC DEFAULT 0,
                    total_transactions INTEGER DEFAULT 0,
                    sent_transactions INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'PREPARING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS batch_transactions (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    wallet_address_to VARCHAR(100),
                    amount_usdc NUMERIC,
                    tx_hash VARCHAR(100),
                    transaction_reference VARCHAR(100),
                    status VARCHAR(20) DEFAULT 'PENDING'
                );
            `);

            // Migración segura: Agregar columnas nuevas si faltan
            await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gas_used VARCHAR(50)`);
            await client.query(`ALTER TABLE batch_transactions ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(100)`);

            // Migración Lotes Refactor
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS total_transactions INTEGER DEFAULT 0`);
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS sent_transactions INTEGER DEFAULT 0`);
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PREPARING'`);

            // Merkle Tree Columns & Table
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS funder_address VARCHAR(100)`);
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS merkle_root VARCHAR(66)`);

            await client.query(`
                CREATE TABLE IF NOT EXISTS merkle_nodes (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    hash VARCHAR(66) NOT NULL,
                    parent_hash VARCHAR(66),
                    level INTEGER NOT NULL,
                    transaction_id INTEGER REFERENCES batch_transactions(id) ON DELETE CASCADE,
                    is_leaf BOOLEAN DEFAULT FALSE,
                    position_index INTEGER
                );
            `);

            // 1. Relayers Table
            await client.query(`
                CREATE TABLE IF NOT EXISTS relayers (
                     id SERIAL PRIMARY KEY,
                     batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                     address VARCHAR(42) NOT NULL,
                     private_key TEXT NOT NULL,
                     total_managed NUMERIC DEFAULT 0,
                     status VARCHAR(20) DEFAULT 'active', -- active, drained, used
                     last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Migración segura para relayers
            await client.query(`ALTER TABLE relayers ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            await client.query(`ALTER TABLE relayers ADD COLUMN IF NOT EXISTS last_balance VARCHAR(50) DEFAULT '0'`);
            await client.query(`ALTER TABLE relayers ADD COLUMN IF NOT EXISTS transactionhash_deposit VARCHAR(66) DEFAULT NULL`);

            // 3. Faucets Table (Persistence per environment/deployment)
            await client.query(`
                CREATE TABLE IF NOT EXISTS faucets (
                    id SERIAL PRIMARY KEY,
                    address VARCHAR(42) NOT NULL,
                    private_key TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            console.log("✅ Tablas verificadas/actualizadas correctamente.");
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ Error conectando a BD:", err);
    }
};
initDB();

// Endpoint de Ayuda: Forzar creación de tablas manualmente
app.get('/setup', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query(`
             CREATE TABLE IF NOT EXISTS batches (
                    id SERIAL PRIMARY KEY,
                    batch_number VARCHAR(50),
                    detail TEXT,
                    description TEXT,
                    total_usdc NUMERIC DEFAULT 0,
                    total_transactions INTEGER DEFAULT 0,
                    sent_transactions INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'PREPARING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            CREATE TABLE IF NOT EXISTS batch_transactions (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    wallet_address_to VARCHAR(100),
                    amount_usdc NUMERIC,
                    tx_hash VARCHAR(100),
                    transaction_reference VARCHAR(100),
                    status VARCHAR(20) DEFAULT 'PENDING'
                );
            ALTER TABLE batch_transactions ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(100);
            
            -- Migracion: Renombrar columna si existe la vieja
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='batch_transactions' AND column_name='wallet_address') THEN
                    ALTER TABLE batch_transactions RENAME COLUMN wallet_address TO wallet_address_to;
                END IF;
            END
            $$;

            ALTER TABLE batches ADD COLUMN IF NOT EXISTS total_transactions INTEGER DEFAULT 0;
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS sent_transactions INTEGER DEFAULT 0;
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PREPARING';
            
            -- Merkle Update
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS funder_address VARCHAR(100);
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS merkle_root VARCHAR(66);

            CREATE TABLE IF NOT EXISTS merkle_nodes (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    hash VARCHAR(66) NOT NULL,
                    parent_hash VARCHAR(66),
                    level INTEGER NOT NULL,
                    transaction_id INTEGER REFERENCES batch_transactions(id) ON DELETE CASCADE,
                    is_leaf BOOLEAN DEFAULT FALSE,
                    position_index INTEGER
                );
        `);
        client.release();
        res.send("<h1>✅ Tablas de Lotes actualizadas (Refactor).</h1>");
    } catch (err) {
        res.status(500).json(err);
    }
});

// ... (API Endpoints: USUARIOS y CURSOS) ...
app.get('/api/users', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/users', async (req, res) => {
    const { nombre, apellido, dni, edad, sexo } = req.body;
    try {
        const query = 'INSERT INTO users (nombre, apellido, dni, edad, sexo) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const values = [nombre, apellido, dni, edad, sexo];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Error creating batch:", err); // Log for Railway
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, apellido, dni, edad, sexo } = req.body;
    try {
        const query = 'UPDATE users SET nombre=$1, apellido=$2, dni=$3, edad=$4, sexo=$5 WHERE id=$6 RETURNING *';
        const result = await pool.query(query, [nombre, apellido, dni, edad, sexo, id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/users/:id', async (req, res) => {
    try { await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]); res.json({ message: "Usuario eliminado" }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/courses', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM courses ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/courses', async (req, res) => {
    const { nombre, descripcion, nivel, fecha_inicio, duracion_semanas } = req.body;
    try {
        const query = 'INSERT INTO courses (nombre, descripcion, nivel, fecha_inicio, duracion_semanas) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const result = await pool.query(query, [nombre, descripcion, nivel, fecha_inicio, duracion_semanas]);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/courses/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, nivel, fecha_inicio, duracion_semanas } = req.body;
    try {
        const query = 'UPDATE courses SET nombre=$1, descripcion=$2, nivel=$3, fecha_inicio=$4, duracion_semanas=$5 WHERE id=$6 RETURNING *';
        const result = await pool.query(query, [nombre, descripcion, nivel, fecha_inicio, duracion_semanas, id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/courses/:id', async (req, res) => {
    try { await pool.query('DELETE FROM courses WHERE id=$1', [req.params.id]); res.json({ message: "Curso eliminado" }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API Endpoints: TRANSACCIONES ---

app.get('/api/transactions', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM transactions ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', async (req, res) => {
    const { tx_hash, from_address, to_address, amount, gas_used } = req.body;
    try {
        const query = 'INSERT INTO transactions (tx_hash, from_address, to_address, amount, gas_used) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const values = [tx_hash, from_address, to_address, amount.toString(), gas_used ? gas_used.toString() : "0"];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- API Endpoints: GESTIÓN DE LOTES (Refactored) ---

// POST: Crear nuevo Lote (Solo Cabecera Básica)
app.post('/api/batches', async (req, res) => {
    const { batch_number, detail, description } = req.body;
    try {
        // Status por defecto: PREPARING. Defaults para stats.
        const query = `
            INSERT INTO batches (
                batch_number, detail, description, status, 
                total_usdc, total_transactions, sent_transactions, created_at
            ) 
            VALUES ($1, $2, $3, 'PREPARING', 0, 0, 0, NOW()) 
            RETURNING *
        `;
        const values = [batch_number, detail, description];
        const result = await pool.query(query, values);
        const newBatch = result.rows[0];

        // Ensure a Faucet exists (Singleton)
        const faucetCheck = await pool.query('SELECT address FROM faucets LIMIT 1');
        if (faucetCheck.rows.length === 0) {
            const wallet = ethers.Wallet.createRandom();
            await pool.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, wallet.privateKey]);
            console.log('🪙 Auto-generated singleton faucet during batch creation:', wallet.address);
        }

        res.status(201).json(newBatch);
    } catch (err) {
        console.error("Error creating batch:", err);
        // Return exact error to client for debugging
        res.status(500).json({ error: err.message || "Database Error" });
    }
});

// POST: Subir Excel + Calcular Totales + Actualizar Estado a READY
app.post('/api/batches/:id/upload', upload.single('file'), async (req, res) => {
    const batchId = req.params.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        // Leer archivo Excel usando ExcelJS
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const worksheet = workbook.worksheets[0];
        const rows = worksheet.getSheetValues(); // rows[0] is undefined
        const headers = rows[1];
        const data = rows.slice(2).map(r => {
            const obj = {};
            headers.forEach((h, i) => {
                if (h) obj[h] = r[i];
            });
            return obj;
        });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let totalAmount = 0;
            let totalCount = 0;

            for (const row of data) {
                // "TransactionID", "Address Wallet", "USDC", "Hash"
                const txRef = row['TransactionID'] || row['TransactionId'] || '';
                const wallet = row['Address Wallet'];
                const amount = parseFloat(row['USDC']);
                const hash = row['Hash'] || '';

                if (wallet && !isNaN(amount)) {
                    await client.query(
                        `INSERT INTO batch_transactions (batch_id, wallet_address_to, amount_usdc, tx_hash, transaction_reference) VALUES ($1, $2, $3, $4, $5)`,
                        [batchId, wallet, amount, hash, txRef]
                    );
                    totalAmount += amount;
                    totalCount++;
                }
            }

            // Actualizar Cabecera del Lote
            await client.query(
                `UPDATE batches SET total_usdc = $1, total_transactions = $2, status = 'READY' WHERE id = $3`,
                [totalAmount, totalCount, batchId]
            );

            await client.query('COMMIT');
            fs.unlinkSync(req.file.path);

            const updatedBatch = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
            const txs = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [batchId]);

            res.json({
                message: 'Lote procesado y calculado',
                batch: updatedBatch.rows[0],
                transactions: txs.rows
            });

        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Obtener todos los lotes
app.get('/api/batches', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM batches ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET: Obtener detalle de un lote
app.get('/api/batches/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const batch = await pool.query('SELECT * FROM batches WHERE id = $1', [id]);
        if (batch.rows.length === 0) return res.status(404).json({ error: 'Lote no encontrado' });

        const txs = await pool.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [id]);

        res.json({ batch: batch.rows[0], transactions: txs.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Generar Merkle Tree
app.post('/api/batches/:id/merkle', async (req, res) => {
    const batchId = req.params.id;
    const { funder_address } = req.body;

    if (!funder_address) return res.status(400).json({ error: "Funder Address Required" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener Transacciones del Lote
        const txsRes = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
        const txs = txsRes.rows;
        if (txs.length === 0) throw new Error("Batch has no transactions");

        // 2. Limpiar Merkle previo (si existe)
        await client.query('DELETE FROM merkle_nodes WHERE batch_id = $1', [batchId]);

        // 2. Fetch Network Info for Hashing (Cached)
        const network = await getNetworkInfo();
        const chainId = network.chainId;
        const contractAddress = process.env.CONTRACT_ADDRESS || "0x78318c7A0d4E7e403A5008F9DA066A489B65cBad";

        // 3. Generar Hojas (Level 0)
        let levelNodes = [];
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();

        for (let i = 0; i < txs.length; i++) {
            const tx = txs[i];

            // Hash Construction: abi.encode(block.chainid, address(this), batchId, txId, funder, recipient, amount)
            const amountVal = BigInt(Math.round(parseFloat(tx.amount_usdc || 0) * 1000000)); // Ensure USDC units (shifted 6 decimals)

            const encodedData = abiCoder.encode(
                ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                [
                    chainId,
                    contractAddress,
                    BigInt(batchId),
                    BigInt(tx.id),
                    funder_address,
                    tx.wallet_address_to,
                    amountVal
                ]
            );
            const hash = ethers.keccak256(encodedData);

            // Insert Leaf
            await client.query(
                `INSERT INTO merkle_nodes (batch_id, hash, parent_hash, level, transaction_id, is_leaf, position_index) 
                 VALUES ($1, $2, NULL, 0, $3, TRUE, $4)`,
                [batchId, hash, tx.id, i]
            );

            levelNodes.push({ hash, index: i });
        }

        // 4. Construir Niveles Superiores
        let currentLevel = 0;
        let currentNodes = levelNodes; // Arreglo de {hash}

        while (currentNodes.length > 1) {
            const nextLevelNodes = [];

            for (let i = 0; i < currentNodes.length; i += 2) {
                const left = currentNodes[i];
                const right = (i + 1 < currentNodes.length) ? currentNodes[i + 1] : left; // Duplicate last if odd

                // Hash Parent = Keccak256(Left + Right)
                const parentHash = ethers.solidityPackedKeccak256(
                    ['bytes32', 'bytes32'],
                    [left.hash, right.hash]
                );

                const nextIndex = nextLevelNodes.length;

                // Insert Parent Node
                await client.query(
                    `INSERT INTO merkle_nodes (batch_id, hash, parent_hash, level, transaction_id, is_leaf, position_index) 
                     VALUES ($1, $2, NULL, $3, NULL, FALSE, $4)`,
                    [batchId, parentHash, currentLevel + 1, nextIndex]
                );

                // Update Children with Parent Hash
                // Updating in loop for simplicity
                await client.query('UPDATE merkle_nodes SET parent_hash = $1 WHERE batch_id = $2 AND level = $3 AND (position_index = $4 OR position_index = $5)',
                    [parentHash, batchId, currentLevel, i, i + 1]);

                nextLevelNodes.push({ hash: parentHash });
            }

            currentLevel++;
            currentNodes = nextLevelNodes;
        }

        const rootHash = currentNodes[0].hash;

        // 5. Actualizar Batch
        await client.query('UPDATE batches SET merkle_root = $1, funder_address = $2 WHERE id = $3', [rootHash, funder_address, batchId]);

        await client.query('COMMIT');

        res.json({ message: "Merkle Tree Generated", root: rootHash });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Relayer System Endpoint
// Relayer System Endpoint
const PROVIDER_URL = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
let sharedProvider = null;
let cachedNetwork = null;

function getProvider() {
    if (!sharedProvider) {
        sharedProvider = new ethers.JsonRpcProvider(PROVIDER_URL, undefined, {
            staticNetwork: true // Optimizes by skipping redundant eth_chainId calls
        });
    }
    return sharedProvider;
}

async function getNetworkInfo() {
    if (!cachedNetwork) {
        cachedNetwork = await getProvider().getNetwork();
    }
    return cachedNetwork;
}

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
            // Generate if missing completely
            const wallet = ethers.Wallet.createRandom();
            faucetPk = wallet.privateKey;
            await pool.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, faucetPk]);
        }

        const providerUrl = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";

        console.log(`[API] Processing Batch ${batchId} requested with relayerCount ${relayerCount || 5}`);
        const engine = new RelayerEngine(pool, providerUrl, faucetPk);

        console.log(`[API] Engine initialized with contract: ${engine.contractAddress}`);
        const setup = await engine.startBatchProcessing(batchId, relayerCount || 5, permitData, rootSignatureData);
        console.log(`[API] startBatchProcessing result:`, setup);
        res.json({ message: "Relayers setup and processing started", batchId, relayers: setup.count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint: Get relayer balances for a batch
// Endpoint: Get relayer balances for a batch (Optimized: Read from DB only)
app.get('/api/relayers/:batchId', async (req, res) => {
    try {
        const batchId = parseInt(req.params.batchId);
        if (isNaN(batchId)) return res.status(400).json({ error: 'Invalid batchId' });

        // Fetch from DB (RelayerEngine updates these values proactively)
        const relayerRes = await pool.query('SELECT id, address, last_activity, last_balance, transactionhash_deposit FROM relayers WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
        const relayers = relayerRes.rows;

        const balances = relayers.map(r => ({
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
        const result = await pool.query('SELECT address, private_key FROM faucets ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) {
            return res.json({ address: null, balance: "0", privateKey: null });
        }
        const { address, private_key: privateKey } = result.rows[0];
        const providerUrl = process.env.PROVIDER_URL || "https://dawn-palpable-telescope.matic.quiknode.pro/e7d140234fbac5b00d93bfedf2e1c555fa2fdb65/";
        const provider = new ethers.JsonRpcProvider(providerUrl);
        const balanceWei = await provider.getBalance(address);
        res.json({ address, balance: ethers.formatEther(balanceWei), privateKey });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/faucet/generate', async (req, res) => {
    try {
        const wallet = ethers.Wallet.createRandom();
        await pool.query('INSERT INTO faucets (address, private_key) VALUES ($1, $2)', [wallet.address, wallet.privateKey]);
        res.json({ message: "Faucet generated", address: wallet.address });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fallback para SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log("🚀 Version: 2.2.0 (DB: wallet_address -> wallet_address_to)");
});
