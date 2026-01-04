// Deployment Trigger: 2026-01-01 15:30
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const ethers = require('ethers');
const multer = require('multer');
const xlsx = require('xlsx');
const RelayerEngine = require('./services/relayerEngine');
const RpcManager = require('./services/rpcManager');
const fs = require('fs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { generateNonce, SiweMessage } = require('siwe');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dappsfactory-secret-key-2026';


// RPC Configuration (Failover)
// RPC Configuration (Failover)
const RPC_PRIMARY = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
const RPC_FALLBACK = process.env.RPC_FALLBACK_URL || "https://fluent-clean-orb.matic.quiknode.pro/d95e5af7a69e7b5f8c09a440a5985865d6f4ae93/"; // Quicknode Fallback
const globalRpcManager = new RpcManager(RPC_PRIMARY, RPC_FALLBACK);

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
const dbUrl = process.env.DATABASE_URL;
console.log(`[DB] Attempting connection to: ${dbUrl ? dbUrl.replace(/:[^:@]*@/, ':****@') : 'UNDEFINED'}`);

const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000
});

// Capture unexpected errors on idle clients to prevent crash
pool.on('error', (err, client) => {
    console.error('❌ Unexpected Error on Idle DB Client:', err.message);
    // process.exit(-1); // Don't exit, try to recover
});

// AUTO-CREATE SESSION TABLE (With Retry)
const initSessionTable = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "session" (
                    "sid" varchar NOT NULL PRIMARY KEY,
                    "sess" json NOT NULL,
                    "expire" timestamp(6) NOT NULL
                );
                CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
            `);
            console.log("📊 Session table verified/created");
            return;
        } catch (err) {
            console.error(`❌ DB Connection Failed (Attempt ${i + 1}/${retries}): ${err.message}`);
            if (i === retries - 1) console.error("❌ Critical: Could not connect to DB after multiple attempts.");
            await new Promise(res => setTimeout(res, 2000)); // Wait 2s
        }
    }
};
initSessionTable();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session Store Setup (Resilient)
let sessionStore;
try {
    sessionStore = new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true,
        errorLog: (err) => console.error('❌ Session Store Error:', err.message)
    });
    console.log("✅ PG Session Store initialized");
} catch (e) {
    console.error("⚠️ Failed to init PG Session Store, falling back to MemoryStore:", e.message);
    sessionStore = new session.MemoryStore();
}

app.use(session({
    store: sessionStore,
    name: 'dappsfactory_session',
    secret: process.env.SESSION_SECRET || 'siwe-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 600000 }
}));

// --- Authentication Middleware ---
const authenticateToken = (req, res, next) => {
    // Fail fast if DB is down for auth routes
    if (pool.totalCount === 0 && !process.env.UseMemoryStore) {
        // Optional: specific check? For now, standard flow.
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Token missing' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user; // { address, role }
        next();
    });
};



const os = require('os');

// Multer for Excel Uploads - Use system temp dir for Railway compatibility
const upload = multer({ dest: os.tmpdir() });

// --- Authentication API ---

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
    } catch (e) {
        res.status(500).json({ status: 'error', db: e.message, uptime: process.uptime() });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5",
        RPC_URL: RPC_PRIMARY
    });
});

app.get('/api/auth/nonce', async (req, res) => {
    try {
        if (!req.session) {
            console.error("❌ Session undefined in /api/auth/nonce");
            return res.status(500).send("Session configuration error");
        }
        req.session.nonce = generateNonce();
        res.setHeader('Content-Type', 'text/plain');
        res.send(req.session.nonce);
    } catch (err) {
        console.error("❌ Nonce Error:", err);
        res.status(500).send("Internal Server Error");
    }
});

// --- Faucet Self-Healing Helper ---
async function ensureUserFaucet(userAddress) {
    if (!userAddress) return;
    const normalizedAddress = userAddress.toLowerCase().trim();
    try {
        const faucetRes = await pool.query('SELECT 1 FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [normalizedAddress]);
        if (faucetRes.rows.length === 0) {
            console.log(`[Self-Heal] No Faucet found for ${normalizedAddress}. generating...`);
            const wallet = ethers.Wallet.createRandom();
            await pool.query('INSERT INTO faucets (address, private_key, funder_address) VALUES ($1, $2, $3)', [wallet.address, wallet.privateKey, normalizedAddress]);
            console.log(`[Self-Heal] Faucet created for ${normalizedAddress}`);
        }
    } catch (e) {
        console.error(`[Self-Heal] Failed for ${normalizedAddress}:`, e.message);
    }
}

app.post('/api/auth/verify', async (req, res) => {
    try {
        const { message, signature } = req.body;
        const siweMessage = new SiweMessage(message);

        const { data: fields } = await siweMessage.verify({
            signature,
            nonce: req.session.nonce,
        });

        if (!fields) return res.status(400).json({ error: 'Signature verification failed' });

        const normalizedAddress = fields.address.toLowerCase().trim();

        // Check user role in DB. Default to REGISTERED for new users.
        const userRes = await pool.query('SELECT role FROM rbac_users WHERE address = $1', [normalizedAddress]);
        let role = 'REGISTERED';
        if (userRes.rows.length > 0) {
            role = userRes.rows[0].role;
        } else {
            // Auto-register as REGISTERED. Admin must upgrade to OPERATOR.
            await pool.query('INSERT INTO rbac_users (address, role) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING', [normalizedAddress, role]);
        }

        // --- PROACTIVE FAUCET CREATION ---
        await ensureUserFaucet(normalizedAddress);

        const token = jwt.sign({ address: normalizedAddress, role: role }, JWT_SECRET, { expiresIn: '12h' });

        res.json({ token, address: normalizedAddress, role });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: e.message });
    }
});

// --- API Endpoints ---

// Get Public Transactions History (Home)


// Get all batches (Filtered by User if not Admin)
app.get('/api/batches', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase().trim();
        const userRole = req.user.role;

        console.log(`[GET Batches] User: ${userAddress} | Role: ${userRole}`);

        await ensureUserFaucet(userAddress);

        const limit = parseInt(req.query.limit) || 20;
        const page = parseInt(req.query.page) || 1;
        const offset = (page - 1) * limit;

        // --- FILTER PARAMETERS ---
        const { date, description, status, amount } = req.query;

        // Base Where
        let whereClause = 'WHERE 1=1';
        let queryParams = [];

        // 1. Role Isolation
        if (userRole !== 'SUPER_ADMIN') {
            queryParams.push(userAddress);
            whereClause += ` AND LOWER(b.funder_address) = $${queryParams.length}`;
        }

        // 2. Date Filter (Exact Match YYYY-MM-DD on created_at)
        if (date && date.trim() !== '') {
            queryParams.push(date.trim());
            whereClause += ` AND DATE(b.created_at) = $${queryParams.length}`;
        }

        // 3. Status Filter (Exact Match)
        if (status && status.trim() !== '' && status !== 'ALL') {
            queryParams.push(status.trim());
            whereClause += ` AND b.status = $${queryParams.length}`;
        }

        // 4. Description/Text Filter (Partial match on description, detail, or batch_number)
        if (description && description.trim() !== '') {
            queryParams.push(`%${description.trim()}%`);
            whereClause += ` AND (b.description ILIKE $${queryParams.length} OR b.detail ILIKE $${queryParams.length} OR b.batch_number ILIKE $${queryParams.length})`;
        }

        // 5. Amount Filter (Range +/- 10%)
        // Amount stored as INTEGER (microUSDC) or STRING in some contexts? 
        // Based on app.js rendering, it seems total_usdc is stored as the atomic value (e.g. 1000000 = 1 USDC).
        // User inputs "100" (USDC). We must convert to 100000000 atomic units then apply +/- 10%.
        if (amount && !isNaN(parseFloat(amount))) {
            const inputVal = parseFloat(amount);
            const lowerBound = Math.floor((inputVal * 0.9) * 1000000); // 90%
            const upperBound = Math.ceil((inputVal * 1.1) * 1000000);  // 110%

            queryParams.push(lowerBound);
            queryParams.push(upperBound);
            // Cast total_usdc to numeric for safe comparison
            whereClause += ` AND (CAST(b.total_usdc AS NUMERIC) BETWEEN $${queryParams.length - 1} AND $${queryParams.length})`;
        }

        // Debug Query Construction
        // console.log(`[GET Batches] Constructed Where: ${whereClause} Params: ${JSON.stringify(queryParams)}`);

        // Count Total (with filters)
        const countQuery = `SELECT COUNT(*) FROM batches b ${whereClause}`;
        const countRes = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countRes.rows[0].count);

        // Fetch Data (with filters)
        const dataQuery = `
            SELECT b.*,
            COUNT(CASE WHEN t.status = 'COMPLETED' THEN 1 END)::int as sent_transactions,
            COUNT(t.id)::int as total_transactions
            FROM batches b 
            LEFT JOIN batch_transactions t ON b.id = t.batch_id
            ${whereClause}
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        // Add Pagination Params
        const fullParams = [...queryParams, limit, offset];
        const result = await pool.query(dataQuery, fullParams);

        res.json({
            batches: result.rows,
            pagination: {
                totalItems,
                currentPage: page,
                totalPages: Math.ceil(totalItems / limit),
                itemsPerPage: limit
            }
        });
    } catch (err) {
        console.error("[GET Batches] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get batch details + transactions (Secure & Isolated)
app.get('/api/batches/:id', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const userAddress = req.user.address.toLowerCase().trim();

        // Use Case Insensitive Owner Check
        const batchRes = await pool.query(`
            SELECT b.* 
            FROM batches b 
            WHERE b.id = $1 ${req.user.role !== 'SUPER_ADMIN' ? 'AND LOWER(b.funder_address) = $2' : ''}
        `, req.user.role !== 'SUPER_ADMIN' ? [batchId, userAddress] : [batchId]);

        console.log(`[DEBUG] Batch Lookup: ID=${batchId}, User=${userAddress}, Role=${req.user.role}, Rows=${batchRes.rows.length}`);


        if (batchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found or access denied' });
        }

        const batch = batchRes.rows[0];

        // Stats distribution for ECharts Doughnut
        const statsRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed,
                COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'ENVIANDO' THEN 1 END) as sending,
                COUNT(CASE WHEN status = 'QUEUED' THEN 1 END) as queued
            FROM batch_transactions 
            WHERE batch_id = $1
        `, [batchId]);

        res.json({ batch, stats: statsRes.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new batch (Capture funder from token)
app.post('/api/batches', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase().trim();
        const { batch_number, detail, description } = req.body;

        const result = await pool.query(
            'INSERT INTO batches (batch_number, detail, description, status, funder_address) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [batch_number, detail, description, 'PREPARING', userAddress]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- API: Admin SQL (Debugging) ---
app.post('/api/admin/sql', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: "Query required" });

        console.log(`[AdminSQL] Executing: ${query} `);
        const result = await pool.query(query);
        res.json({ rows: result.rows, rowCount: result.rowCount, fields: result.fields });
    } catch (err) {
        console.error(`[AdminSQL] Error: ${err.message} `);
        res.status(500).json({ error: err.message });
    }
});

// --- API: Admin Unblock Faucets ---
app.post('/api/admin/unblock-faucets', authenticateToken, async (req, res) => {
    try {
        // Verify SUPER_ADMIN role
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN role required.' });
        }

        console.log(`[Admin] Unblock Faucets requested by ${req.user.address}`);

        // Fetch all faucets from database
        const faucetsRes = await pool.query('SELECT address, private_key, funder_address FROM faucets ORDER BY id ASC');
        const faucets = faucetsRes.rows;

        if (faucets.length === 0) {
            return res.json({ success: true, results: [], message: 'No faucets found in database' });
        }

        console.log(`[Admin] Found ${faucets.length} faucets to check`);

        // Use Global RPC Manager for redundancy
        const provider = globalRpcManager.getProvider();

        const results = [];

        // Check and repair each faucet
        for (const faucet of faucets) {
            try {
                const wallet = new ethers.Wallet(faucet.private_key, provider);
                const address = wallet.address;

                // Get nonce status
                const latestNonce = await provider.getTransactionCount(address, "latest");
                const pendingNonce = await provider.getTransactionCount(address, "pending");
                const balance = await provider.getBalance(address);

                const isBlocked = pendingNonce > latestNonce;
                const nonceDiff = pendingNonce - latestNonce;

                console.log(`[Admin] Checking ${address.substring(0, 10)}... | Latest: ${latestNonce} | Pending: ${pendingNonce} | Blocked: ${isBlocked}`);

                let repairResult = {
                    address: address,
                    funderAddress: faucet.funder_address || 'N/A',
                    balance: ethers.formatEther(balance),
                    latestNonce: latestNonce,
                    pendingNonce: pendingNonce,
                    status: isBlocked ? 'blocked' : 'clean',
                    repaired: false,
                    txHash: null,
                    error: null
                };

                // If blocked, attempt repair
                if (isBlocked) {
                    console.log(`[Admin] 🔧 Repairing ${address.substring(0, 10)}... (${nonceDiff} tx stuck)`);

                    try {
                        const feeData = await provider.getFeeData();
                        const boostPrice = (feeData.gasPrice * 30n) / 10n; // 3x gas

                        const tx = await wallet.sendTransaction({
                            to: address,
                            value: 0,
                            nonce: latestNonce,
                            gasLimit: 30000,
                            gasPrice: boostPrice
                        });

                        console.log(`[Admin] 💉 Repair TX sent: ${tx.hash}`);

                        // Wait for confirmation with timeout
                        await Promise.race([
                            tx.wait(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 60000))
                        ]);

                        // Verify repair
                        const newLatest = await provider.getTransactionCount(address, "latest");
                        const newPending = await provider.getTransactionCount(address, "pending");

                        repairResult.repaired = true;
                        repairResult.txHash = tx.hash;
                        repairResult.status = (newPending === newLatest) ? 'repaired' : 'partially_repaired';
                        repairResult.latestNonce = newLatest;
                        repairResult.pendingNonce = newPending;

                        console.log(`[Admin] ✅ Repair complete for ${address.substring(0, 10)}...`);

                    } catch (repairErr) {
                        console.error(`[Admin] ❌ Repair failed for ${address.substring(0, 10)}...:`, repairErr.message);
                        repairResult.error = repairErr.message;
                        repairResult.status = 'repair_failed';
                    }
                }

                results.push(repairResult);

            } catch (checkErr) {
                console.error(`[Admin] Error checking faucet ${faucet.address}:`, checkErr.message);
                results.push({
                    address: faucet.address,
                    funderAddress: faucet.funder_address || 'N/A',
                    balance: '0',
                    latestNonce: 0,
                    pendingNonce: 0,
                    status: 'error',
                    repaired: false,
                    txHash: null,
                    error: checkErr.message
                });
            }
        }

        const summary = {
            total: results.length,
            clean: results.filter(r => r.status === 'clean').length,
            blocked: results.filter(r => r.status === 'blocked').length,
            repaired: results.filter(r => r.status === 'repaired').length,
            failed: results.filter(r => r.status === 'repair_failed' || r.status === 'error').length
        };

        console.log(`[Admin] Unblock complete. Summary:`, summary);

        res.json({
            success: true,
            summary: summary,
            results: results
        });

    } catch (err) {
        console.error('[Admin] Unblock Faucets Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Upload Excel & Calculate Totals (Secure)
app.post('/api/batches/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
    const client = await pool.connect();
    try {
        const batchId = req.params.id;
        const userAddress = req.user.address.toLowerCase();

        // Verify Ownership
        const ownerRes = await client.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        if (req.user.role !== 'SUPER_ADMIN' && ownerRes.rows[0].funder_address?.toLowerCase() !== userAddress) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const filePath = req.file.path;

        // Create batch id log
        console.log(`[UPLOAD] Starting for Batch ID: ${batchId} `);
        console.log(`[UPLOAD] Reading file: ${filePath} `);

        let workbook;
        try {
            workbook = xlsx.readFile(filePath);
        } catch (readErr) {
            console.error("[UPLOAD] Error reading file:", readErr);
            throw new Error("Failed to parse Excel file");
        }

        const sheetName = workbook.SheetNames[0];
        console.log(`[UPLOAD] Sheet Name: ${sheetName} `);

        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        console.log(`[UPLOAD] Rows found: ${data.length} `);

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
                console.log(`[UPLOAD] Processing Row ${loopIndex}: Wallet = ${wallet}, Amount = ${amount} `);
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
                        console.error(`[UPLOAD] Row ${loopIndex} Error: `, rowErr.message);
                    }
                } else {
                    console.warn(`[UPLOAD] Row ${loopIndex} Invalid Address: ${cleanWallet} `);
                }
            } else {
                console.warn(`[UPLOAD] Row ${loopIndex} Missing Data: `, row);
            }
        }

        console.log(`[UPLOAD] Finished Loop.ValidTxs: ${validTxs} `);

        if (validTxs === 0) {
            const foundKeys = data.length > 0 ? Object.keys(data[0]).join(', ') : "Ninguna (Archivo vacío)";
            throw new Error(`No se encontraron transacciones válidas.Columnas detectadas: [${foundKeys}].Se busca: 'Wallet' y 'Amount'.`);
        }

        // Update Batch Totals and FULLY RESET status/stats for new file
        const updateRes = await client.query(
            `UPDATE batches SET
total_transactions = $1,
    total_usdc = $2,
    status = $3,
    merkle_root = NULL,
    total_gas_used = NULL,
    execution_time = NULL,
    start_time = NULL,
    end_time = NULL,
    funding_amount = NULL,
    refund_amount = NULL
            WHERE id = $4 RETURNING * `,
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
app.post('/api/batches/:id/register-merkle', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const batchId = req.params.id;
        // Use user address from JWT instead of trust body
        const normalizedFunder = req.user.address.toLowerCase();

        // Safety check: verify user owns this batch before calculating Merkle
        const ownershipCheck = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (req.user.role !== 'SUPER_ADMIN' && ownershipCheck.rows[0]?.funder_address?.toLowerCase() !== normalizedFunder) {
            return res.status(403).json({ error: 'You do not own this batch' });
        }

        const txRes = await client.query('SELECT id, wallet_address_to, amount_usdc FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
        const txs = txRes.rows;

        if (txs.length === 0) throw new Error("No transactions in batch");

        const provider = globalRpcManager.getProvider();
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

        // Get batch details for logging
        const batchDetails = await client.query('SELECT batch_number, total_transactions FROM batches WHERE id = $1', [batchId]);
        const batchInfo = batchDetails.rows[0];

        await client.query('COMMIT');

        // 🌳 DETAILED MERKLE TREE CREATION LOG
        console.log('\n========================================');
        console.log('🌳 MERKLE TREE GENERATED SUCCESSFULLY');
        console.log('========================================');
        console.log(`📦 Batch ID:          ${batchId}`);
        console.log(`🔢 Batch Number:      ${batchInfo.batch_number}`);
        console.log(`📊 Total Txs:         ${batchInfo.total_transactions}`);
        console.log(`👤 Funder Address:    ${normalizedFunder}`);
        console.log(`🌲 Merkle Root:       ${root}`);
        console.log(`⏰ Timestamp:         ${new Date().toISOString()}`);
        console.log('========================================\n');

        res.json({ root });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('❌ [Merkle Tree] Generation Failed:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET Faucet Helper (User-Specific)
async function getFaucetCredentials(userAddress) {
    if (!userAddress) throw new Error("Faucet lookup requires User Address");

    const normalizedUser = userAddress.toLowerCase();

    // 1. Try finding specific faucet for this user (Case Insensitive)
    const faucetRes = await pool.query('SELECT private_key FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [normalizedUser]);

    if (faucetRes.rows.length > 0) {
        return faucetRes.rows[0].private_key;
    }

    // 2. Fallback or Create
    console.log(`[Faucet] No faucet found for ${normalizedUser}. Generating new one...`);
    const wallet = ethers.Wallet.createRandom();
    await pool.query('INSERT INTO faucets (address, private_key, funder_address) VALUES ($1, $2, $3)', [wallet.address, wallet.privateKey, normalizedUser]);
    return wallet.privateKey;
}

// Phase 1: Setup & Fund Relayers (Secure)
app.post('/api/batches/:id/setup', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const userAddress = req.user.address.toLowerCase();

        // Verify Ownership
        const ownerRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        const batchOwner = ownerRes.rows[0].funder_address?.toLowerCase();

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            console.warn(`[Setup] Access Denied. Owner=${batchOwner}, User=${userAddress}`);
            return res.status(403).json({ error: 'Access denied' });
        }

        const { relayerCount } = req.body;
        const safeRelayerCount = relayerCount || 5;
        if (safeRelayerCount > 100) {
            throw new Error("Maximum Relayer limit is 100 (Safe). 1000 causes Block Gas Limit errors.");
        }

        // Use BATCH OWNER'S faucet (usually same as user, but for Admin overriding, use Batch Owner)
        const faucetPk = await getFaucetCredentials(batchOwner);

        const engine = new RelayerEngine(pool, globalRpcManager, faucetPk);

        const result = await engine.prepareRelayers(batchId, safeRelayerCount);
        res.json({ message: "Relayers created and funded", count: result.count });
    } catch (err) {
        console.error("[Setup] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Phase 2: Start Execution (Swarm) (Secure)
app.post('/api/batches/:id/execute', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const userAddress = req.user.address.toLowerCase();

        console.log('\n========================================');
        console.log('🚀 BATCH EXECUTION REQUEST RECEIVED');
        console.log('========================================');
        console.log(`📦 Batch ID:          ${batchId}`);
        console.log(`👤 User Address:      ${userAddress}`);
        console.log(`🔐 User Role:         ${req.user.role}`);
        console.log(`⏰ Timestamp:         ${new Date().toISOString()}`);

        // Verify Ownership
        const ownerRes = await pool.query('SELECT funder_address, merkle_root, total_transactions, status FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) {
            console.log('❌ Batch not found');
            console.log('========================================\n');
            return res.status(404).json({ error: 'Batch not found' });
        }

        const batch = ownerRes.rows[0];
        const batchOwner = batch.funder_address?.toLowerCase();

        console.log(`📊 Batch Status:      ${batch.status}`);
        console.log(`🌲 Merkle Root:       ${batch.merkle_root || 'NOT SET ❌'}`);
        console.log(`📨 Total Txs:         ${batch.total_transactions}`);
        console.log(`👑 Batch Owner:       ${batchOwner}`);

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            console.log('❌ Access denied - User is not owner');
            console.log('========================================\n');
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!batch.merkle_root) {
            console.log('❌ CRITICAL: Merkle Root not generated!');
            console.log('   → User must generate Merkle Tree first');
            console.log('========================================\n');
            return res.status(400).json({ error: 'Merkle Root not generated. Please generate the Merkle Tree first.' });
        }

        console.log('✅ Prerequisites check passed');
        console.log('🔧 Initializing RelayerEngine...');

        const { permitData, rootSignatureData } = req.body;

        // Use BATCH OWNER'S faucet
        const faucetPk = await getFaucetCredentials(batchOwner);

        const engine = new RelayerEngine(pool, globalRpcManager, faucetPk);

        console.log('🎬 Starting execution in background...');
        console.log('========================================\n');

        const result = await engine.startExecution(batchId, permitData, rootSignatureData);
        res.json(result);
    } catch (err) {
        console.error("❌ [Execute] Error:", err);
        console.log('========================================\n');
        res.status(500).json({ error: err.message });
    }
});

// Keep /process alias for backwards compatibility or rename it
app.post('/api/batches/:id/process', async (req, res) => {
    res.status(410).json({ error: "Deprecated. Use /execute" });
});



const QUICKNODE_URL = "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

// Faucet Management API (User Specific)
app.get('/api/faucet', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();

        // 1. Check existing faucet for THIS user (Case Insensitive)
        const result = await pool.query('SELECT * FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [userAddress]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            const provider = globalRpcManager.getProvider();
            const balance = await provider.getBalance(row.address);
            res.json({
                address: row.address,
                privateKey: row.private_key, // Admin/Owner view only
                balance: ethers.formatEther(balance)
            });
        } else {
            // AUTO-GENERATE for this user
            console.log(`🔍 No Faucet found for ${userAddress}, generating new one...`);
            const wallet = ethers.Wallet.createRandom();
            await pool.query('INSERT INTO faucets (address, private_key, funder_address) VALUES ($1, $2, $3)', [wallet.address, wallet.privateKey, userAddress]);
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

app.post('/api/faucet/generate', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();
        const wallet = ethers.Wallet.createRandom();

        // Ensure we don't have multiple (Delete old ones for this user)
        await pool.query('DELETE FROM faucets WHERE LOWER(funder_address) = $1', [userAddress]);

        await pool.query('INSERT INTO faucets (address, private_key, funder_address) VALUES ($1, $2, $3)', [wallet.address, wallet.privateKey, userAddress]);

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
        CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5",
        // Unit: Seconds (Default: 2 Hours = 7200s)
        PERMIT_DEADLINE_SECONDS: process.env.PERMIT_DEADLINE_SECONDS || 7200
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
app.get('/api/batches/:id/transactions', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const userAddress = req.user.address.toLowerCase().trim();

        // 1. Verify Ownership / Access
        const batchRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);

        if (batchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const batchFunder = batchRes.rows[0].funder_address?.toLowerCase();

        if (req.user.role !== 'SUPER_ADMIN' && batchFunder !== userAddress) {
            return res.status(403).json({ error: 'Access denied' });
        }

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
            // Correct wildcard placement without spaces
            params.push(`%${wallet}%`);
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

        // Query execution
        query += ` ORDER BY id ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
        params.push(limit, offset);

        const countRes = await pool.query(countQuery, params.slice(0, paramIdx - 1));
        const totalItems = parseInt(countRes.rows[0].count);

        const result = await pool.query(query, params);

        res.json({
            transactions: result.rows,
            total: totalItems,
            page: parseInt(page),
            totalPages: Math.ceil(totalItems / limit)
        });

    } catch (err) {
        console.error("Tx Search Error:", err);
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
        // Parallel Live Balance Check (With Failover Support)
        // const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        // const provider = new ethers.JsonRpcProvider(providerUrl);
        const provider = globalRpcManager.getProvider(); // Dynamic Provider

        // Throttled Live Balance Check (Chunk Size: 5)
        const CHUNK_SIZE = 5;
        const updatedRelayers = [];

        for (let i = 0; i < relayers.length; i += CHUNK_SIZE) {
            const chunk = relayers.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(chunk.map(async (r) => {
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
                    console.warn(`Failed to sync balance for ${r.address}: `, e.message);
                    return { ...r, balance: r.db_balance || "0", private_key: undefined };
                }
            }));
            updatedRelayers.push(...chunkResults);
            // Small delay between chunks to be nice to the RPC
            if (i + CHUNK_SIZE < relayers.length) await new Promise(resolve => setTimeout(resolve, 200));
        }

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
app.post('/api/batches/:id/return-funds', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);
        const userAddress = req.user.address.toLowerCase();

        // Verify Ownership to get owner address
        const ownerRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        const batchOwner = ownerRes.rows[0].funder_address?.toLowerCase();

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Use BATCH OWNER'S faucet
        const faucetPk = await getFaucetCredentials(batchOwner);
        // const providerUrl = process.env.PROVIDER_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";
        const engine = new RelayerEngine(pool, globalRpcManager, faucetPk);

        // Call the method physically (assuming updated RelayerEngine exposes it)
        const recovered = await engine.returnFundsToFaucet(batchId);
        res.json({ success: true, message: `Recovery process completed.Recovered: ${recovered || 0} MATIC` });
    } catch (err) {
        console.error("[Refund] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: Trigger Rescue Script (Legacy - Background)
app.post('/api/admin/rescue', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acceso Denegado' });
        }

        console.log(`[Admin] 🛠️ User ${req.user.address} triggering Fund Rescue...`);

        // Spawn script in background
        const { spawn } = require('child_process');
        const child = spawn('node', ['scripts/rescue_relayer_funds.js'], {
            stdio: 'inherit', // Log to server console
            detached: true    // Run independently
        });

        child.unref(); // Don't wait for it

        res.json({ message: "Script de rescate iniciado en segundo plano. Revisa la consola del servidor." });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: Get Rescue Status (Dashboard)
app.get('/api/admin/rescue-status', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN role required.' });
        }

        const batchId = req.query.batchId ? parseInt(req.query.batchId) : null;

        // Query relayers with their faucet mapping
        let query = `
            SELECT 
                r.address,
                r.last_balance,
                r.batch_id,
                r.status as relayer_status,
                f.address as faucet_address,
                b.funder_address
            FROM relayers r
            LEFT JOIN batches b ON r.batch_id = b.id
            LEFT JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
        `;

        let params = [];
        if (batchId) {
            query += ' WHERE r.batch_id = $1';
            params.push(batchId);
        } else {
            // Last 1000 batches
            query += ` WHERE r.batch_id IN (
                SELECT id FROM batches ORDER BY id DESC LIMIT 1000
            )`;
        }

        query += ' ORDER BY r.id DESC';

        const result = await pool.query(query, params);

        // Get balances from blockchain
        // Get balances from blockchain
        const provider = globalRpcManager.getProvider();

        const relayersWithBalance = await Promise.all(
            result.rows.map(async (r) => {
                try {
                    const balance = await provider.getBalance(r.address);
                    const balanceEth = ethers.formatEther(balance);
                    const balanceNum = parseFloat(balanceEth);

                    return {
                        address: r.address,
                        balance: balanceEth,
                        balanceNum: balanceNum,
                        faucetAddress: r.faucet_address || 'Unknown',
                        batchId: r.batch_id,
                        status: r.relayer_status === 'drained' ? 'completed' : (balanceNum > 0.01 ? 'pending' : 'completed')
                    };
                } catch (err) {
                    return {
                        address: r.address,
                        balance: '0',
                        balanceNum: 0,
                        faucetAddress: r.faucet_address || 'Unknown',
                        batchId: r.batch_id,
                        status: 'error',
                        error: err.message
                    };
                }
            })
        );

        // Calculate summary
        const summary = {
            total: relayersWithBalance.length,
            pending: relayersWithBalance.filter(r => r.status === 'pending').length,
            processing: 0, // Will be updated during active rescue
            completed: relayersWithBalance.filter(r => r.status === 'completed').length,
            failed: relayersWithBalance.filter(r => r.status === 'error').length,
            totalBalance: relayersWithBalance.reduce((sum, r) => sum + r.balanceNum, 0).toFixed(4) + ' MATIC'
        };

        res.json({
            relayers: relayersWithBalance,
            summary: summary
        });

    } catch (err) {
        console.error('[Admin] Rescue Status Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN: Execute Rescue (Dashboard)
app.post('/api/admin/rescue-execute', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN role required.' });
        }

        const { batchId } = req.body;

        console.log(`[Admin] 💰 User ${req.user.address} starting rescue${batchId ? ` for batch ${batchId}` : ' for all relayers'}...`);

        // Execute rescue inline (not background) for better control
        // Execute rescue inline (not background) for better control
        const provider = globalRpcManager.getProvider();

        // Get relayers to rescue
        let query = `
            SELECT 
                r.address,
                r.private_key,
                r.batch_id,
                f.address as faucet_address
            FROM relayers r
            LEFT JOIN batches b ON r.batch_id = b.id
            LEFT JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
        `;

        let params = [];
        if (batchId) {
            query += ' WHERE r.batch_id = $1';
            params.push(batchId);
        } else {
            query += ` WHERE r.batch_id IN (
                SELECT id FROM batches ORDER BY id DESC LIMIT 1000
            )`;
        }

        const result = await pool.query(query, params);
        const relayers = result.rows;

        if (relayers.length === 0) {
            return res.json({ success: true, message: 'No relayers found to rescue', rescued: 0 });
        }

        // Get gas price
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 35000000000n;
        const boostedGasPrice = (gasPrice * 130n) / 100n;
        const gasLimit = 21000n;
        const minCost = gasLimit * boostedGasPrice;
        const safetyMargin = ethers.parseEther("0.1");

        let rescued = 0;
        let totalRescued = 0n;
        const results = [];

        // Process sequentially to avoid RPS issues
        for (const r of relayers) {
            try {
                if (!r.faucet_address) {
                    console.warn(`[Rescue] Skipping ${r.address}: No faucet found`);
                    continue;
                }

                const wallet = new ethers.Wallet(r.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                if (balance > (minCost + safetyMargin)) {
                    const amountToReturn = balance - minCost - safetyMargin;

                    const tx = await wallet.sendTransaction({
                        to: r.faucet_address,
                        value: amountToReturn,
                        gasLimit: gasLimit,
                        gasPrice: boostedGasPrice
                    });

                    await tx.wait();

                    console.log(`[Rescue] ✅ ${wallet.address.substring(0, 8)}... → ${r.faucet_address.substring(0, 8)}... | ${ethers.formatEther(amountToReturn)} MATIC | TX: ${tx.hash}`);

                    totalRescued += amountToReturn;
                    rescued++;

                    // Update DB
                    await pool.query(
                        "UPDATE relayers SET last_balance = $1, last_activity = NOW(), status = 'drained' WHERE address = $2",
                        ['0', r.address]
                    );

                    results.push({
                        address: r.address,
                        faucet: r.faucet_address,
                        amount: ethers.formatEther(amountToReturn),
                        txHash: tx.hash,
                        status: 'success'
                    });
                }

                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (err) {
                console.error(`[Rescue] ❌ Failed for ${r.address}:`, err.message);
                results.push({
                    address: r.address,
                    status: 'failed',
                    error: err.message
                });
            }
        }

        res.json({
            success: true,
            message: `Rescued ${rescued} relayers`,
            rescued: rescued,
            totalAmount: ethers.formatEther(totalRescued) + ' MATIC',
            results: results
        });

    } catch (err) {
        console.error('[Admin] Rescue Execute Error:', err);
        res.status(500).json({ error: err.message });
    }
});

const VERSION = "2.3.0";
const PORT_LISTEN = process.env.PORT || 3000;

app.listen(PORT_LISTEN, () => {
    console.log(`Server is running on port ${PORT_LISTEN} `);
    console.log(`🚀 Version: ${VERSION} (Self - Healing & Performance Record)`);
});



