// Deployment Trigger: 2026-01-08 18:50 - Excel Export Feature
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
const faucetService = require('./services/faucet'); // Import Faucet Service
const InstantRelayerEngine = require('./services/instantRelayerEngine');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
    throw new Error('[Security] JWT_SECRET env var is required but not set. Refusing to start.');
}
const JWT_SECRET = process.env.JWT_SECRET;


// RPC Configuration - Multi-RPC Support (1-5 RPCs)
// Reads RPC_URL_1 through RPC_URL_5 from environment
const rpcUrls = [
    process.env.RPC_URL_1,
    process.env.RPC_URL_2,
    process.env.RPC_URL_3,
    process.env.RPC_URL_4,
    process.env.RPC_URL_5
].filter(Boolean);

if (rpcUrls.length === 0) {
    throw new Error('[RPC] No RPC URLs configured. Set at least RPC_URL_1 in environment.');
}

console.log(`[RPC] Configuring ${rpcUrls.length} RPC endpoint(s)...`);
const globalRpcManager = new RpcManager(rpcUrls);

// ChainId from environment (default: 137 = Polygon Mainnet)
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '137');

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
// Database Connection
const dbUrl = process.env.DATABASE_URL;
console.log(`[DB] Using Database URL: ${dbUrl ? 'DEFINED (Masked)' : 'UNDEFINED'}`);

const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 30, // Increase pool size for concurrent Merkle verification
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Capture unexpected errors on idle clients to prevent crash
pool.on('error', (err, client) => {
    console.error('❌ Unexpected Error on Idle DB Client:', err.message);
});

// AUTO-CREATE SESSION TABLE (Resilient with Retry for Railway Private Network)
const initSessionTable = async (maxRetries = 5, delayMs = 2000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[DB] Connection attempt ${attempt}/${maxRetries}...`);
            await pool.query('SELECT 1');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "session" (
                    "sid" varchar NOT NULL PRIMARY KEY,
                    "sess" json NOT NULL,
                    "expire" timestamp(6) NOT NULL
                );
                CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
            `);
            console.log("✅ Session table verified/created");
            return true;
        } catch (err) {
            console.error(`⚠️ DB Init Failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
            if (attempt < maxRetries) {
                console.log(`   Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                console.error("❌ DB connection failed after all retries. Using MemoryStore.");
                return false;
            }
        }
    }
    return false;
};

// Vault integration removed - not in use

// ─── Instant Payment Migration ───────────────────────────────────────────────
const initInstantPaymentTables = async () => {
    try {
        const sql = require('fs').readFileSync(require('path').join(__dirname, 'migrations/004_instant_payment.sql'), 'utf8');
        await pool.query(sql);
        console.log('[InstantPayment] ✅ DB tables verified/created');
    } catch (err) {
        console.error('[InstantPayment] ⚠️ Migration error:', err.message);
    }
};

// Warm up the connection (don't block server start)
let dbReady = false;
initSessionTable().then(async ready => {
    dbReady = ready;
    if (ready) {
        console.log('🔥 Database connection warmed up successfully');
        await initInstantPaymentTables();
    }
});

// Middleware
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session Store Setup (Resilient)
let sessionStore;

try {
    sessionStore = new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true,
        errorLog: (err) => {
            console.error('❌ Session Store Error:', err.message);
        }
    });
    console.log("✅ PG Session Store initialized");
} catch (e) {
    console.error("⚠️ Failed to create PG Store, fallback to Memory:", e.message);
    sessionStore = new session.MemoryStore();
}

app.use(session({
    store: sessionStore,
    name: 'dappsfactory_session',
    secret: process.env.SESSION_SECRET || 'siwe-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: (parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 120) * 60 * 1000 // Default: 120 minutes (2 hours)
    }
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
        if (err) {
            console.warn(`[Auth] ❌ Authentication failed for ${req.path}: ${err.message}`);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.user = user; // { address, role }
        next();
    });
};



const os = require('os');


// Multer for Excel Uploads - Use system temp dir for Railway compatibility
const upload = multer({ dest: os.tmpdir() });

// --- Authentication API ---

// Vault endpoints removed - not in use

// --- SEND POL FROM FAUCET ---
app.post('/api/faucet/send-pol', authenticateToken, async (req, res) => {
    try {
        const { recipientAddress, amount, funderAddress } = req.body;

        if (!funderAddress) {
            return res.status(401).json({ success: false, error: 'Funder address required' });
        }

        // Validate recipient address
        if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
            return res.status(400).json({ success: false, error: 'Invalid recipient address' });
        }

        // Validate amount
        const amountWei = ethers.parseEther(amount.toString());
        if (amountWei <= 0n) {
            return res.status(400).json({ success: false, error: 'Amount must be greater than 0' });
        }

        // Get blockchain provider
        const provider = globalRpcManager.getProvider();

        // Get faucet wallet from Vault
        console.log(`[Faucet Send] 🔍 Resolving faucet for: ${funderAddress || 'DEFAULT'}...`);
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, funderAddress);
        console.log(`[Faucet Send] 🔑 Using Faucet Wallet: ${faucetWallet.address}`);

        // Get current balance
        const balance = await provider.getBalance(faucetWallet.address);

        // Estimate gas
        console.log(`[Faucet Send] ⛽ Estimating gas for transfer to ${recipientAddress}...`);
        const feeData = await provider.getFeeData();

        let gasLimit = 21000n; // Standard fallback
        try {
            // Check if recipient is a contract and needs more gas
            const estimated = await provider.estimateGas({
                from: faucetWallet.address,
                to: recipientAddress,
                value: amountWei
            });
            // Add 20% margin to the estimation
            gasLimit = (estimated * 120n) / 100n;
            console.log(`[Faucet Send] 📊 Dynamic gas limit estimated: ${gasLimit.toString()}`);
        } catch (e) {
            console.warn(`[Faucet Send] ⚠️ Gas estimation failed: ${e.message}. Using default 21000.`);
            // If it's a contract, 21000 might still fail, but we'll try or fail later.
        }

        const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('100', 'gwei');
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('30', 'gwei');
        const estimatedGasCost = gasLimit * maxFeePerGas;

        // Reserve extra gas for safety (1.5x instead of 2x to be less aggressive)
        const gasReserve = (estimatedGasCost * 15n) / 10n;
        const maxAvailable = balance - gasReserve;

        console.log(`[Faucet Send] 💰 Balance: ${ethers.formatEther(balance)} POL`);
        console.log(`[Faucet Send] 📊 Gas Calculation: Limit(${gasLimit}) * MaxFee(${ethers.formatUnits(maxFeePerGas, 'gwei')} gwei) = ${ethers.formatEther(estimatedGasCost)} POL`);
        console.log(`[Faucet Send] 🛡️ Gas Reserve (1.5x): ${ethers.formatEther(gasReserve)} POL`);
        console.log(`[Faucet Send] ✅ Max Available: ${ethers.formatEther(maxAvailable)} POL`);

        if (maxAvailable <= 0n) {
            console.error(`[Faucet Send] ❌ Insufficient balance for gas. Needed reserve: ${ethers.formatEther(gasReserve)}, Have: ${ethers.formatEther(balance)}`);
            return res.status(400).json({
                success: false,
                error: 'Insufficient balance for gas',
                balance: ethers.formatEther(balance),
                gasReserve: ethers.formatEther(gasReserve)
            });
        }

        if (amountWei > maxAvailable) {
            console.error(`[Faucet Send] ❌ Requested amount ${ethers.formatEther(amountWei)} exceeds max available ${ethers.formatEther(maxAvailable)}`);
            return res.status(400).json({
                success: false,
                error: 'Amount exceeds available balance (after gas reserve)',
                maxAvailable: ethers.formatEther(maxAvailable),
                requested: ethers.formatEther(amountWei)
            });
        }

        // Get nonce with retry logic (anti-bloqueo)
        let nonce;
        let retries = 3;
        while (retries > 0) {
            try {
                nonce = await provider.getTransactionCount(faucetWallet.address, 'pending');
                break;
            } catch (e) {
                retries--;
                if (retries === 0) throw e;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Build transaction
        // User requested NOT setting a gas limit explicitly due to high costs/congestion.
        // Ethers will estimate it automatically during sendTransaction.
        const tx = {
            to: recipientAddress,
            value: amountWei,
            // gasLimit removed per user request
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            nonce: nonce,
            chainId: 137 // Polygon Mainnet
        };

        console.log(`[Faucet Send] ✍️ Signing and sending transaction (Nonce: ${nonce})...`);

        // Send transaction
        const txResponse = await faucetWallet.sendTransaction(tx);

        console.log(`[Faucet Send] TX Hash: ${txResponse.hash}`);

        // Wait for confirmation (with timeout)
        const receipt = await Promise.race([
            txResponse.wait(1),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 60000))
        ]);

        res.json({
            success: true,
            txHash: txResponse.hash,
            amount: ethers.formatEther(amountWei),
            recipient: recipientAddress,
            gasUsed: ethers.formatEther(receipt.gasUsed * receipt.gasPrice),
            explorerUrl: `https://polygonscan.com/tx/${txResponse.hash}`
        });

    } catch (error) {
        console.error('[Faucet Send] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.code || 'UNKNOWN_ERROR'
        });
    }
});



app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
    } catch (e) {
        res.status(500).json({ status: 'error', db: e.message, uptime: process.uptime() });
    }
});






app.get('/api/auth/nonce', async (req, res) => {
    try {
        console.log(`[Auth] Generating Nonce for SessionID: ${req.sessionID} `);
        if (!req.session) {
            console.error("❌ Session undefined in /api/auth/nonce");
            return res.status(500).json({ error: "Session configuration error" });
        }
        req.session.nonce = generateNonce();

        // Save session and wait for confirmation
        await new Promise((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error("❌ Session save error:", err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        console.log(`[Auth] Nonce generated and saved: ${req.session.nonce} `);
        res.json({ nonce: req.session.nonce });
    } catch (err) {
        console.error("❌ Nonce Error:", err);
        res.status(500).json({ error: "Failed to generate nonce: " + err.message });
    }
});

// --- Faucet Self-Healing Helper ---
async function ensureUserFaucet(userAddress) {
    if (!userAddress) return;
    try {
        console.log(`[Self-Heal] Ensuring Faucet for ${userAddress}...`);
        await globalRpcManager.execute(async (provider) => {
            await faucetService.getFaucetWallet(pool, provider, userAddress);
        });
    } catch (e) {
        console.error(`[Self-Heal] Failed for ${userAddress}: `, e.message);
    }
}

app.post('/api/auth/verify', async (req, res) => {
    try {
        const { message, signature } = req.body;
        const siweMessage = new SiweMessage(message);

        console.log(`[Auth] Verifying Signature.SessionID: ${req.sessionID} `);
        console.log(`[Auth] Stored Nonce: ${req.session ? req.session.nonce : 'UNDEFINED'} `);

        if (!req.session || !req.session.nonce) {
            console.error("[Auth] Missing nonce in session. Potential Cookie/Session mismatch.");
            return res.status(422).json({ error: "Sesión expirada o inválida (Nonce perdido). Recarga la página." });
        }

        const { data: fields } = await siweMessage.verify({
            signature,
            nonce: req.session.nonce,
        });

        if (!fields) return res.status(400).json({ error: 'Firma inválida' });

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

        console.log(`[GET Batches]User: ${userAddress} | Role: ${userRole} `);

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
            whereClause += ` AND LOWER(b.funder_address) = $${queryParams.length} `;
        }

        // 2. Date Filter (Exact Match YYYY-MM-DD on created_at)
        if (date && date.trim() !== '') {
            queryParams.push(date.trim());
            whereClause += ` AND DATE(b.created_at) = $${queryParams.length} `;
        }

        // 3. Status Filter (Exact Match)
        if (status && status.trim() !== '' && status !== 'ALL') {
            queryParams.push(status.trim());
            whereClause += ` AND b.status = $${queryParams.length} `;
        }

        // 4. Description/Text Filter (Partial match on description, detail, or batch_number)
        if (description && description.trim() !== '') {
            queryParams.push(`% ${description.trim()}% `);
            whereClause += ` AND(b.description ILIKE $${queryParams.length} OR b.detail ILIKE $${queryParams.length} OR b.batch_number ILIKE $${queryParams.length})`;
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
            whereClause += ` AND(CAST(b.total_usdc AS NUMERIC) BETWEEN $${queryParams.length - 1} AND $${queryParams.length})`;
        }

        // Debug Query Construction
        // console.log(`[GET Batches] Constructed Where: ${ whereClause } Params: ${ JSON.stringify(queryParams) } `);

        // Count Total (with filters)
        const countQuery = `SELECT COUNT(*) FROM batches b ${whereClause} `;
        const countRes = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countRes.rows[0].count);

        // Fetch Data (with filters)
        const dataQuery = `
            SELECT b.*,
    COUNT(CASE WHEN t.status = 'COMPLETED' THEN 1 END):: int as sent_transactions,
        COUNT(t.id):: int as total_transactions
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

// Get batch details + transactions (Public for polling - no auth required for GET)
app.get('/api/batches/:id', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.id);

        // Get batch without authentication (public for polling)
        const batchRes = await pool.query(`
            SELECT b.*
    FROM batches b 
            WHERE b.id = $1
    `, [batchId]);

        if (batchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
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

// Get transactions for a batch with filters (for Excel export)
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const { batchId, wallet, amount, status } = req.query;

        if (!batchId) {
            return res.status(400).json({ error: 'batchId is required' });
        }

        // Build WHERE clause with filters
        let whereClause = 'WHERE batch_id = $1';
        let queryParams = [parseInt(batchId)];
        let paramIndex = 2;

        // Filter by wallet address (partial match)
        if (wallet && wallet.trim() !== '') {
            queryParams.push(`%${wallet.trim().toLowerCase()}%`);
            whereClause += ` AND LOWER(wallet_address_to) LIKE $${paramIndex}`;
            paramIndex++;
        }

        // Filter by amount (exact match or range)
        if (amount && amount.trim() !== '') {
            const amountValue = parseFloat(amount.trim());
            if (!isNaN(amountValue)) {
                queryParams.push(amountValue);
                whereClause += ` AND amount_usdc = $${paramIndex}`;
                paramIndex++;
            }
        }

        // Filter by status
        if (status && status.trim() !== '' && status !== 'ALL' && status !== 'Todos los Estados') {
            queryParams.push(status.trim());
            whereClause += ` AND status = $${paramIndex}`;
            paramIndex++;
        }

        // Query transactions with filters
        const query = `
            SELECT 
                id,
                wallet_address_to as recipient_address,
                amount_usdc as amount,
                amount_transferred as amount_sent,
                tx_hash,
                updated_at as timestamp,
                status
            FROM batch_transactions
            ${whereClause}
            ORDER BY id ASC
        `;

        console.log(`[GET Transactions] Query: ${query}, Params:`, queryParams);

        const result = await pool.query(query, queryParams);

        res.json(result.rows);
    } catch (err) {
        console.error('[GET Transactions] Error:', err);
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




// --- API: Admin Unblock Faucets ---
app.post('/api/admin/unblock-faucets', authenticateToken, async (req, res) => {
    try {
        // Verify SUPER_ADMIN role
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Access denied. SUPER_ADMIN role required.' });
        }

        console.log(`[Admin] Unblock Faucets requested by ${req.user.address} `);

        // Fetch all faucets from database (No private keys here, we get them from Vault)
        const faucetsRes = await pool.query('SELECT address, funder_address FROM faucets ORDER BY id ASC');
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
                // Vault integration removed - keys are now stored in database only
                // const privateKey = await vault.getFaucetKey(faucet.address);
                // if (!privateKey) throw new Error("Key not found in Vault");

                const [latestNonce, pendingNonce, balance, feeData] = await globalRpcManager.execute(async (provider) => {
                    const lNonce = await provider.getTransactionCount(address, "latest");
                    const pNonce = await provider.getTransactionCount(address, "pending");
                    const bal = await provider.getBalance(address);
                    const fees = await provider.getFeeData();
                    return [lNonce, pNonce, bal, fees];
                });

                const isBlocked = pendingNonce > latestNonce;
                const nonceDiff = pendingNonce - latestNonce;

                console.log(`[Admin] Checking ${address.substring(0, 10)}... | Latest: ${latestNonce} | Pending: ${pendingNonce} | Blocked: ${isBlocked} `);

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
                        const boostPrice = (feeData.gasPrice * 30n) / 10n; // 3x gas

                        const tx = await globalRpcManager.execute(async (provider) => {
                            const wallet = new ethers.Wallet(privateKey, provider);
                            return await wallet.sendTransaction({
                                to: address,
                                value: 0,
                                nonce: latestNonce,
                                gasLimit: 30000,
                                gasPrice: boostPrice
                            });
                        });

                        console.log(`[Admin] 💉 Repair TX sent: ${tx.hash} `);

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
                        console.error(`[Admin] ❌ Repair failed for ${address.substring(0, 10)}...: `, repairErr.message);
                        repairResult.error = repairErr.message;
                        repairResult.status = 'repair_failed';
                    }
                }

                results.push(repairResult);

            } catch (checkErr) {
                console.error(`[Admin] Error checking faucet ${faucet.address}: `, checkErr.message);
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

        console.log(`[Admin] Unblock complete.Summary: `, summary);

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
            return res.status(401).json({ error: 'You do not own this batch' });
        }

        const txRes = await client.query('SELECT id, wallet_address_to, amount_usdc FROM batch_transactions WHERE batch_id = $1 ORDER BY id ASC', [batchId]);
        const txs = txRes.rows;

        if (txs.length === 0) throw new Error("No transactions in batch");

        // Use constant chainId (no RPC call, no async)
        const chainId = CHAIN_ID;
        const contractAddress = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";

        // 1. Generate Leaves (100% local computation)
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

        console.log(`[Merkle] 🌳 Building tree for ${leaves.length} leaves...`);

        // 2. Build Tree Level by Level
        let currentLevelNodes = leaves.map((l, idx) => ({
            batch_id: batchId,
            level: 0,
            position_index: idx,
            hash: l.hash,
            transaction_id: l.id
        }));

        // OPTIMIZED: Batch insert Level 0 (all leaves at once)
        if (currentLevelNodes.length > 0) {
            const valuesClauses = [];
            const params = [];
            let paramIndex = 1;

            for (const node of currentLevelNodes) {
                valuesClauses.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);
                params.push(node.batch_id, node.level, node.position_index, node.hash, node.transaction_id);
                paramIndex += 5;
            }

            const batchInsertQuery = `
                INSERT INTO merkle_nodes(batch_id, level, position_index, hash, transaction_id)
                VALUES ${valuesClauses.join(', ')}
`;

            await client.query(batchInsertQuery, params);
            console.log(`[Merkle] ✅ Inserted ${currentLevelNodes.length} leaves(Level 0)`);
        }

        let level = 0;
        while (currentLevelNodes.length > 1) {
            level++;
            const nextLevelNodes = [];
            const parentUpdates = []; // Store parent-child relationships

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

                nextLevelNodes.push(parentNode);

                // Store relationships for batch update
                parentUpdates.push({ parentHash, leftHash: left.hash, rightHash: right.hash });
            }

            // OPTIMIZED: Batch insert all nodes for this level
            if (nextLevelNodes.length > 0) {
                const valuesClauses = [];
                const params = [];
                let paramIndex = 1;

                for (const node of nextLevelNodes) {
                    valuesClauses.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
                    params.push(node.batch_id, node.level, node.position_index, node.hash);
                    paramIndex += 4;
                }

                const batchInsertQuery = `
                    INSERT INTO merkle_nodes(batch_id, level, position_index, hash)
                    VALUES ${valuesClauses.join(', ')}
`;

                await client.query(batchInsertQuery, params);
                console.log(`[Merkle] ✅ Inserted ${nextLevelNodes.length} nodes(Level ${level})`);
            }

            // OPTIMIZED: Batch update parent relationships using CASE statement
            if (parentUpdates.length > 0) {
                const whenClauses = [];
                const hashList = [];

                for (const update of parentUpdates) {
                    whenClauses.push(`WHEN hash = '${update.leftHash}' THEN '${update.parentHash}'`);
                    hashList.push(`'${update.leftHash}'`);

                    if (update.rightHash !== update.leftHash) {
                        whenClauses.push(`WHEN hash = '${update.rightHash}' THEN '${update.parentHash}'`);
                        hashList.push(`'${update.rightHash}'`);
                    }
                }

                const batchUpdateQuery = `
                    UPDATE merkle_nodes
                    SET parent_hash = CASE
                        ${whenClauses.join(' ')}
END
                    WHERE batch_id = $1 AND hash IN(${hashList.join(', ')})
    `;

                await client.query(batchUpdateQuery, [batchId]);
                console.log(`[Merkle] ✅ Updated ${parentUpdates.length} parent relationships(Level ${level})`);
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
        console.log(`📦 Batch ID:          ${batchId} `);
        console.log(`🔢 Batch Number:      ${batchInfo.batch_number} `);
        console.log(`📊 Total Txs:         ${batchInfo.total_transactions} `);
        console.log(`👤 Funder Address:    ${normalizedFunder} `);
        console.log(`🌲 Merkle Root:       ${root} `);
        console.log(`⏰ Timestamp:         ${new Date().toISOString()} `);
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

// GET Faucet Helper (User-Specific) - VAULT INTEGRATED
// GET Faucet Helper (User-Specific) - VAULT INTEGRATED
async function getFaucetCredentials(userAddress) {
    if (!userAddress) throw new Error("Faucet lookup requires User Address");

    // Delegate to unified Faucet Service logic
    // This handles: DB lookup -> Vault lookup (by Faucet Address) -> Strict Integrity -> Generation -> Saving
    const wallet = await globalRpcManager.execute(async (provider) => {
        return await faucetService.getFaucetWallet(pool, provider, userAddress);
    });

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
            console.warn(`[Setup] Access Denied.Owner = ${batchOwner}, User = ${userAddress} `);
            return res.status(401).json({ error: 'Access denied' });
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
        console.log(`📦 Batch ID:          ${batchId} `);
        console.log(`👤 User Address:      ${userAddress} `);
        console.log(`🔐 User Role:         ${req.user.role} `);
        console.log(`⏰ Timestamp:         ${new Date().toISOString()} `);

        // Verify Ownership
        const ownerRes = await pool.query('SELECT funder_address, merkle_root, total_transactions, status FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) {
            console.log('❌ Batch not found');
            console.log('========================================\n');
            return res.status(404).json({ error: 'Batch not found' });
        }

        const batch = ownerRes.rows[0];
        const batchOwner = batch.funder_address?.toLowerCase();

        console.log(`📊 Batch Status:      ${batch.status} `);
        console.log(`🌲 Merkle Root:       ${batch.merkle_root || 'NOT SET ❌'} `);
        console.log(`📨 Total Txs:         ${batch.total_transactions} `);
        console.log(`👑 Batch Owner:       ${batchOwner} `);

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            console.log('❌ Access denied - User is not owner');
            console.log('========================================\n');
            return res.status(401).json({ error: 'Access denied' });
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




// Faucet Management API (User Specific)
// Faucet Management API (User Specific)
app.get('/api/faucet', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();

        // 1. Check existing faucet for THIS user
        const result = await pool.query('SELECT address, funder_address FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [userAddress]);

        if (result.rows.length > 0) {
            const row = result.rows[0];

            // USE NEW SYSTEM: globalRpcManager.execute()
            const balanceData = await globalRpcManager.execute(async (provider) => {
                const balWei = await provider.getBalance(row.address);
                const maticBalance = ethers.formatEther(balWei);

                // Also fetch USDC balance for the Faucet
                let usdcBalance = "0.00";
                try {
                    const usdcAddr = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
                    const usdc = new ethers.Contract(usdcAddr, ["function balanceOf(address) view returns (uint256)"], provider);
                    const balUsdc = await usdc.balanceOf(row.address);
                    usdcBalance = ethers.formatUnits(balUsdc, 6);
                } catch (e) {
                    console.warn(`[API] Faucet USDC Fetch error for ${row.address}: `, e.message);
                }

                // Fetch fee data context
                let gasReserve = "0.05";
                let feeData = { maxFeePerGas: "0", maxPriorityFeePerGas: "0" };
                try {
                    const fData = await provider.getFeeData();
                    feeData.maxFeePerGas = fData.maxFeePerGas ? fData.maxFeePerGas.toString() : "0";
                    feeData.maxPriorityFeePerGas = fData.maxPriorityFeePerGas ? fData.maxPriorityFeePerGas.toString() : "0";

                    const gasLimit = 21000n;
                    const maxFee = fData.maxFeePerGas || ethers.parseUnits('100', 'gwei');
                    const cost = (gasLimit * maxFee * 15n) / 10n;
                    gasReserve = ethers.formatEther(cost);
                } catch (err) {
                    console.warn("Error fetching gas data:", err.message);
                }

                return { maticBalance, usdcBalance, gasReserve, feeData };
            });

            let privateKey = "STORED_IN_DATABASE";
            // Vault integration removed - keys are stored in encrypted database
            // try {
            //     const k = await vault.getFaucetKey(row.address);
            //     if (k) privateKey = k;
            // } catch (e) {
            //     console.warn("Vault lookup failed:", e.message);
            //     privateKey = "VAULT_ERROR";
            // }

            res.json({
                address: row.address,
                privateKey: privateKey,
                balance: balanceData.maticBalance,
                usdcBalance: balanceData.usdcBalance,
                gasReserve: balanceData.gasReserve,
                feeData: balanceData.feeData
            });
        } else {
            // AUTO-GENERATE for this user
            console.log(`🔍 No Faucet found for ${userAddress}, generating new one via Vault...`);
            const newPk = await getFaucetCredentials(userAddress);
            const newFaucetRes = await pool.query('SELECT * FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [userAddress]);

            if (newFaucetRes.rows.length > 0) {
                const row = newFaucetRes.rows[0];
                res.json({
                    address: row.address,
                    privateKey: newPk,
                    balance: '0',
                    usdcBalance: '0',
                    gasReserve: '0.05',
                    feeData: { maxFeePerGas: "0", maxPriorityFeePerGas: "0" }
                });
            } else {
                throw new Error("Failed to generate faucet");
            }
        }
    } catch (err) {
        console.error("Error fetching faucet:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/faucet/generate', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();
        const provider = globalRpcManager.getProvider();

        // Ensure we don't have multiple (Delete old ones for this user to force regeneration)
        await pool.query('DELETE FROM faucets WHERE LOWER(funder_address) = $1', [userAddress]);

        // faucetService.getFaucetWallet handles generation and secure Vault storage if not found
        const wallet = await globalRpcManager.execute(async (provider) => {
            return await faucetService.getFaucetWallet(pool, provider, userAddress);
        });

        res.json({ address: wallet.address });
    } catch (err) {
        console.error("[Faucet] Generate error:", err);
        res.status(500).json({ error: err.message });
    }
});

// NEW: Resilient Balance Endpoint (Uses Backend RPC Manager)
app.get('/api/balances/:address', authenticateToken, async (req, res) => {
    try {
        const address = req.params.address;
        const userAddress = req.user.address.toLowerCase();

        // Security: Only allow fetching your own balance
        if (address.toLowerCase() !== userAddress) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const balances = await globalRpcManager.execute(async (provider) => {
            // Fetch MATIC balance
            const maticWei = await provider.getBalance(address);
            const matic = ethers.formatEther(maticWei);

            // Fetch USDC balance
            let usdc = "0.00";
            let allowance = "0.00";
            try {
                const usdcAddr = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
                const usdcContract = new ethers.Contract(
                    usdcAddr,
                    [
                        "function balanceOf(address) view returns (uint256)",
                        "function allowance(address owner, address spender) view returns (uint256)"
                    ],
                    provider
                );

                const usdcWei = await usdcContract.balanceOf(address);
                usdc = ethers.formatUnits(usdcWei, 6);

                // Fetch allowance for the contract
                const contractAddr = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
                const allowanceWei = await usdcContract.allowance(address, contractAddr);
                allowance = ethers.formatUnits(allowanceWei, 6);
            } catch (e) {
                console.warn(`[API] USDC fetch error for ${address}: `, e.message);
            }

            return { matic, usdc, allowance };
        });

        res.json(balances);
    } catch (err) {
        console.error("[Balances] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- RPC PROXY (For Frontend 100% Backend-Only Interaction) ---
app.post('/api/rpc', async (req, res) => {
    try {
        const result = await globalRpcManager.execute(async (provider) => {
            return await provider.send(req.body.method, req.body.params || []);
        });

        res.json({
            jsonrpc: "2.0",
            id: req.body.id,
            result: result
        });
    } catch (err) {
        console.error("[RPC Proxy] Error:", err.message);
        res.status(500).json({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
                code: -32603,
                message: err.message
            }
        });
    }
});

// NEW: Contract Nonce Endpoint (For Ledger Compatibility)
app.get('/api/contract/nonce/:address', authenticateToken, async (req, res) => {
    try {
        const address = req.params.address;
        const userAddress = req.user.address.toLowerCase();

        // Security: Only allow fetching your own nonce
        if (address.toLowerCase() !== userAddress) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const nonce = await globalRpcManager.execute(async (provider) => {
            const contractAddr = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
            const distributorAbi = ["function nonces(address owner) view returns (uint256)"];
            const contract = new ethers.Contract(contractAddr, distributorAbi, provider);
            return await contract.nonces(address);
        });

        res.json({ nonce: nonce.toString() });
    } catch (err) {
        console.error("[Contract Nonce] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// NEW: USDC Nonce Endpoint (For Permit Signature with Ledger)
app.get('/api/usdc/nonce/:address', authenticateToken, async (req, res) => {
    try {
        const address = req.params.address;
        const userAddress = req.user.address.toLowerCase();

        // Security: Only allow fetching your own nonce
        if (address.toLowerCase() !== userAddress) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const nonce = await globalRpcManager.execute(async (provider) => {
            const usdcAddr = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
            const usdcAbi = ["function nonces(address) view returns (uint256)"];
            const contract = new ethers.Contract(usdcAddr, usdcAbi, provider);
            return await contract.nonces(address);
        });

        res.json({ nonce: nonce.toString() });
    } catch (err) {
        console.error("[USDC Nonce] Error:", err);
        res.status(500).json({ error: err.message });
    }
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
app.get('/api/batches/:batchId/transactions/:txId/proof', authenticateToken, async (req, res) => {
    let client;
    try {
        const batchId = parseInt(req.params.batchId);
        const txId = parseInt(req.params.txId);

        if (isNaN(batchId) || isNaN(txId)) {
            return res.status(400).json({ error: 'Invalid ID parameters' });
        }

        client = await pool.connect();
        const proof = await getMerkleProof(client, batchId, txId);
        res.json({ proof });
    } catch (err) {
        console.error(`[Proof] ❌ Error for Batch ${req.params.batchId}, Tx ${req.params.txId}:`, err.message);
        res.status(500).json({ error: err.message });
    } finally {
        if (client) client.release();
    }
});

// New Endpoint: Verify Merkle Proof On-Chain using Balanced RPCs
app.post('/api/batches/:batchId/transactions/:txId/verify-onchain', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.batchId);
        const txId = parseInt(req.params.txId);
        const { funder, recipient, amount, merkleRoot, proof } = req.body;

        if (!funder || !recipient || !amount || !merkleRoot || !proof) {
            return res.status(400).json({ error: 'Missing verification data' });
        }

        // --- DIAGNOSTIC: Calculate Leaf locally to compare ---
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const encoded = abiCoder.encode(
            ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
            [CHAIN_ID, process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5", BigInt(batchId), BigInt(txId), funder.toLowerCase().trim(), recipient.toLowerCase().trim(), BigInt(amount)]
        );
        const leafHash = ethers.keccak256(encoded);

        // --- DIAGNOSTIC: Local JS Verification ---
        let current = leafHash;
        for (const p of proof) {
            const [h1, h2] = [current, p];
            const [first, second] = BigInt(h1) < BigInt(h2) ? [h1, h2] : [h2, h1];
            current = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [first, second]);
        }
        const locallyVerified = (current.toLowerCase() === merkleRoot.toLowerCase());

        console.log(`[VerifyDiag] Tx ${txId} | Local Result: ${locallyVerified ? '✅ OK' : '❌ FAIL'}`);
        if (!locallyVerified) {
            console.warn(`[VerifyDiag]   Calculated Root: ${current}`);
            console.warn(`[VerifyDiag]   Expected Root:   ${merkleRoot}`);
        }

        const contractAddress = process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5";
        const abi = ["function validateMerkleProofDetails(uint256, uint256, address, address, uint256, bytes32, bytes32[]) external view returns (bool)"];

        const isValid = await globalRpcManager.execute(async (provider) => {
            const contract = new ethers.Contract(contractAddress, abi, provider);
            return await contract.validateMerkleProofDetails(
                BigInt(batchId),
                BigInt(txId),
                funder,
                recipient,
                BigInt(amount),
                merkleRoot,
                proof
            );
        }, 5);

        res.json({ isValid, locallyVerified, leafHash });
    } catch (err) {
        console.error(`[VerifyAPI] ❌ Error for Batch ${req.params.batchId}, Tx ${req.params.txId}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Fallback para SPA moved to bottom




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
            return res.status(401).json({ error: 'Access denied' });
        }

        const { page = 1, limit = 10, wallet, amount, status } = req.query;
        const offset = (page - 1) * limit;

        // Build Dynamic Query
        let query = `SELECT * FROM batch_transactions WHERE batch_id = $1`;
        let countQuery = `SELECT count(*) FROM batch_transactions WHERE batch_id = $1`;
        const params = [batchId];
        let paramIdx = 2;

        if (wallet) {
            query += ` AND wallet_address_to ILIKE $${paramIdx} `;
            countQuery += ` AND wallet_address_to ILIKE $${paramIdx} `;
            // Correct wildcard placement without spaces
            params.push(`% ${wallet}% `);
            paramIdx++;
        }

        if (status) {
            query += ` AND status = $${paramIdx} `;
            countQuery += ` AND status = $${paramIdx} `;
            params.push(status);
            paramIdx++;
        }

        if (amount) {
            // Amount in database is microUSDC (integer). Input is USDC (float).
            const amountMicro = Math.round(parseFloat(amount) * 1000000);
            query += ` AND amount_usdc = $${paramIdx} `;
            countQuery += ` AND amount_usdc = $${paramIdx} `;
            params.push(amountMicro);
            paramIdx++;
        }

        // Query execution
        query += ` ORDER BY id ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1} `;
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
app.get('/api/relayers/:batchId', authenticateToken, async (req, res) => {
    try {
        const batchId = parseInt(req.params.batchId);
        // Fetch relayers from DB
        // Fetch relayers from DB with Transaction Count
        const result = await pool.query(`
SELECT
r.id, r.address, r.status, r.last_activity, r.transactionhash_deposit, r.last_balance as db_balance,
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
                    const balWei = await globalRpcManager.execute(async (provider) => {
                        return provider.getBalance(r.address);
                    });
                    const balFormatted = ethers.formatEther(balWei);

                    // Update DB async (fire and forget)
                    pool.query('UPDATE relayers SET last_balance = $1, last_activity = NOW() WHERE id = $2', [balFormatted, r.id]).catch(console.error);

                    return {
                        ...r,
                        balance: balFormatted, // Override with live data
                        last_activity: new Date().toISOString(), // Reflect sync activity
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





// Get first transaction ID of a batch (for Excel export offset calculation)
app.get('/api/batches/:id/first-transaction', authenticateToken, async (req, res) => {
    try {
        const batchId = req.params.id;

        // SECURITY: Verify batch ownership
        const ownerCheck = await pool.query(
            'SELECT funder_address FROM batches WHERE id = $1',
            [batchId]
        );

        if (ownerCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const batchOwner = ownerCheck.rows[0].funder_address?.toLowerCase();
        const userAddress = req.user.address.toLowerCase();

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            return res.status(401).json({ error: 'Access denied' });
        }

        const result = await pool.query(
            'SELECT MIN(id) as first_id FROM batch_transactions WHERE batch_id = $1',
            [batchId]
        );

        if (result.rows.length > 0 && result.rows[0].first_id) {
            res.json({ firstId: result.rows[0].first_id });
        } else {
            res.json({ firstId: 1 });
        }
    } catch (err) {
        console.error('Error getting first transaction ID:', err);
        res.status(500).json({ error: err.message });
    }
});

// Health check for deployment verification
app.get('/api/health-check', (req, res) => {
    res.json({
        status: 'OK',
        version: '3.3.2-excel-export',
        timestamp: new Date().toISOString(),
        endpoints: {
            transactions: 'available',
            firstTransaction: 'available'
        }
    });
});

// Get transactions for a batch with optional filters (for Excel export)
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const { batchId, wallet, amount, status } = req.query;

        if (!batchId) {
            return res.status(400).json({ error: 'batchId is required' });
        }

        // SECURITY: Verify batch ownership
        const ownerCheck = await pool.query(
            'SELECT funder_address FROM batches WHERE id = $1',
            [batchId]
        );

        if (ownerCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const batchOwner = ownerCheck.rows[0].funder_address?.toLowerCase();
        const userAddress = req.user.address.toLowerCase();

        // Only allow batch owner or SUPER_ADMIN to export
        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            return res.status(401).json({ error: 'Access denied: You can only export your own batches' });
        }

        // Build dynamic query with filters
        let query = `
            SELECT id, recipient_address, amount, amount_sent, tx_hash, status, created_at as timestamp
            FROM batch_transactions
            WHERE batch_id = $1
    `;
        const params = [batchId];
        let paramIndex = 2;

        // Add wallet filter if provided
        if (wallet && wallet.trim()) {
            query += ` AND LOWER(recipient_address) LIKE LOWER($${paramIndex})`;
            params.push(`% ${wallet.trim()}% `);
            paramIndex++;
        }

        // Add amount filter if provided
        if (amount && amount.trim()) {
            query += ` AND amount = $${paramIndex} `;
            params.push(amount.trim());
            paramIndex++;
        }

        // Add status filter if provided
        if (status && status.trim()) {
            query += ` AND status = $${paramIndex} `;
            params.push(status.trim());
            paramIndex++;
        }

        query += ` ORDER BY id ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching transactions:', err);
        res.status(500).json({ error: err.message });
    }
});

// Recovery Dashboard API
app.get('/api/recovery/batches', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();

        const query = `
            SELECT b.id, b.total_transactions, b.status as batch_status,
    COUNT(r.id) as total_relayers,
    SUM(CASE WHEN r.status != 'drained' THEN CAST(COALESCE(NULLIF(r.last_balance, ''), '0') AS DECIMAL) ELSE 0 END) as total_pol,
    b.funder_address
            FROM batches b
            JOIN relayers r ON b.id = r.batch_id
            WHERE LOWER(b.funder_address) = $1
            GROUP BY b.id, b.total_transactions, b.status, b.funder_address
            HAVING SUM(CASE WHEN r.status != 'drained' THEN CAST(COALESCE(NULLIF(r.last_balance, ''), '0') AS DECIMAL) ELSE 0 END) > 0.001
            ORDER BY b.id DESC
        `;
        const result = await pool.query(query, [userAddress]);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching recovery batches:", err);
        res.status(500).json({ error: err.message });
    }
});

// Fallback para SPA (Al final de todo) - Excluir /api/* para devolver 404 real en endpoints inexistentes
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Manual Fund Recovery Endpoint
app.post('/api/batches/:id/return-funds', authenticateToken, async (req, res) => {
    try {
        const batchId = req.params.id;
        process.stdout.write(`\n\n[LOG - FORCE] 🚀 User ${req.user.address} requested fund recovery for Batch ${batchId}\n\n`);

        const engine = new RelayerEngine(pool, globalRpcManager, await getFaucetCredentials(req.user.address)); // Ensure context

        // Verify Ownership to get owner address
        const ownerRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        const batchOwner = ownerRes.rows[0].funder_address?.toLowerCase();

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== req.user.address.toLowerCase()) {
            return res.status(401).json({ error: 'Access denied' });
        }

        // Use BATCH OWNER'S faucet
        // const faucetPk = await getFaucetCredentials(batchOwner);
        // Note: 'engine' is already instantiated above with (pool, globalRpcManager, await getFaucetCredentials(req.user.address))
        // If we need to *switch* context to batchOwner, we should probably re-instantiate or ensure the credentials match.
        // For now, let's stick with the instantiated engine but ensure it's using the correct keys.
        // If the user is SUPER_ADMIN, they might be using their own keys to rescue? 
        // Actually, existing code tried to re-declare 'engine'. Let's fix that blocking error first.

        // We really want the engine to use the Batch Owner's credentials IF possible, or the Admin's if explicitly overriding.
        // But getFaucetCredentials(req.user.address) was passed above.

        // Let's just use the existing 'engine' instance.
        const recovered = await engine.returnFundsToFaucet(batchId);
        res.json({ success: true, message: `Recovery process completed.Recovered: ${recovered || 0} MATIC` });
    } catch (err) {
        console.error("[Refund] Error:", err);
        res.status(500).json({ error: err.message });
    }
});



// ADMIN: Get Rescue Status (Dashboard)
app.get('/api/admin/rescue-status', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') {
            return res.status(401).json({ error: 'Access denied. SUPER_ADMIN role required.' });
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
            query += ` WHERE r.batch_id IN(
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
                    const balance = await globalRpcManager.execute(async (provider) => {
                        return provider.getBalance(r.address);
                    });
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
            return res.status(401).json({ error: 'Access denied. SUPER_ADMIN role required.' });
        }

        const { batchId } = req.body;

        console.log(`[Admin] 💰 User ${req.user.address} starting rescue${batchId ? ` for batch ${batchId}` : ' for all relayers'}...`);

        // Use a generic faucet (admin-controlled) or infer from batch
        // For simplicity/safety, we instantiate specific engines per batch found.

        let targetBatches = [];
        if (batchId) {
            targetBatches = [{ id: batchId }];
        } else {
            const batchRes = await pool.query(`
                SELECT DISTINCT batch_id as id FROM relayers 
                WHERE status != 'drained' 
                AND batch_id IS NOT NULL
                ORDER BY batch_id DESC LIMIT 50
    `);
            targetBatches = batchRes.rows;
        }

        const results = [];
        let totalRescued = 0;

        for (const batch of targetBatches) {
            try {
                // Get Owner for this batch to init engine correctly
                const ownerRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batch.id]);
                if (ownerRes.rows.length === 0) continue;

                const funderAddr = ownerRes.rows[0].funder_address;
                const faucetPk = await getFaucetCredentials(funderAddr);

                const engine = new RelayerEngine(pool, globalRpcManager, faucetPk);

                // Use robust method with built-in NONCE REPAIR
                const recovered = await engine.returnFundsToFaucet(batch.id);

                if (recovered) {
                    totalRescued += parseFloat(recovered); // recovered is string or number? currently not returning value
                    results.push({ batchId: batch.id, status: 'success' });
                }
            } catch (batchErr) {
                console.error(`[Admin] Rescue failed for Batch ${batch.id}: `, batchErr.message);
                results.push({ batchId: batch.id, status: 'failed', error: batchErr.message });
            }
        }

        res.json({
            success: true,
            message: `Admin rescue process completed.`,
            batches_processed: results.length,
            results: results
        });

    } catch (err) {
        console.error('[Admin] Rescue Execute Error:', err);
        res.status(500).json({ error: err.message });
    }
});



// --- API: Recover Single Relayer Funds ---
app.post('/api/relayer/:address/recover', authenticateToken, async (req, res) => {
    try {
        const relayerAddress = req.params.address;
        console.log(`[RelayerRecovery] Request to recover funds from ${relayerAddress} `);

        // 1. Find Relayer and Linked Faucet
        const query = `
            SELECT r.address, r.batch_id, f.address as faucet_address
            FROM relayers r
            JOIN batches b ON r.batch_id = b.id
            LEFT JOIN faucets f ON LOWER(f.funder_address) = LOWER(b.funder_address)
            WHERE LOWER(r.address) = LOWER($1)
            LIMIT 1
    `;
        const dbRes = await pool.query(query, [relayerAddress]);

        if (dbRes.rows.length === 0) {
            return res.status(404).json({ error: "Relayer not found" });
        }

        const relayer = dbRes.rows[0];
        if (!relayer.faucet_address) {
            return res.status(400).json({ error: "No Faucet linked to this relayer's funder." });
        }

        const provider = globalRpcManager.getProvider();

        // Vault integration removed - using database for key storage
        throw new Error("This endpoint requires vault integration which has been removed. Keys are now stored in encrypted database.");
        // const relayerPrivateKey = await vault.getRelayerKey(relayerAddress);
        // if (!relayerPrivateKey) throw new Error("Key not found in Vault");
        const wallet = new ethers.Wallet(relayerPrivateKey, provider);

        // 2. Check Balance & Nonce Status
        const [balance, latestNonce, pendingNonce, feeData] = await globalRpcManager.execute(async (provider) => {
            const bal = await provider.getBalance(wallet.address);
            const lNonce = await provider.getTransactionCount(wallet.address, "latest");
            const pNonce = await provider.getTransactionCount(wallet.address, "pending");
            const fees = await provider.getFeeData();
            return [bal, lNonce, pNonce, fees];
        });

        console.log(`[RelayerRecovery] ${relayerAddress} | Balance: ${ethers.formatEther(balance)} | Latest: ${latestNonce} | Pending: ${pendingNonce} `);

        const gasPrice = (feeData.gasPrice * 150n) / 100n; // 1.5x Gas
        const gasLimit = 21000n;
        const minCost = gasPrice * gasLimit;

        if (balance <= minCost) {
            return res.status(400).json({ error: `Insufficient funds.Balance: ${ethers.formatEther(balance)} MATIC` });
        }

        // 3. Auto-Unblock (Nuclear Option)
        if (pendingNonce > latestNonce) {
            console.log(`[RelayerRecovery] ⚠️ Relayer Blocked(${pendingNonce - latestNonce} txs).Attempting auto - undblock...`);

            // Send 0 MATIC to self with high gas to clear the queue
            const unblockPrice = (feeData.gasPrice * 250n) / 100n; // 2.5x Gas for unblock

            try {
                // Determine nonce: Use latest to overwrite/fill the gap
                const txUnblock = await wallet.sendTransaction({
                    to: wallet.address,
                    value: 0n,
                    gasPrice: unblockPrice,
                    gasLimit: gasLimit,
                    nonce: latestNonce // Force the gap to close
                });
                console.log(`[RelayerRecovery] 🧹 Unblock Transaction Sent: ${txUnblock.hash} `);

                await Promise.race([
                    txUnblock.wait(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for unblock")), 30000))
                ]);
                console.log(`[RelayerRecovery] ✅ Unblock Confirmed.`);

            } catch (unblockErr) {
                console.error(`[RelayerRecovery] ❌ Unblock Failed: ${unblockErr.message} `);
                // Proceed cautiously or abort? 
                // If unblock failed (e.g. out of gas), sweep might also fail.
                // But we try anyway with remaining balance.
            }
        }

        // 4. Re-Check Balance after potential unblock cost
        const finalBalance = await globalRpcManager.execute(async (provider) => {
            return provider.getBalance(wallet.address);
        });
        if (finalBalance <= minCost) {
            return res.status(400).json({ error: `Insufficient funds after unblock attempt.Balance: ${ethers.formatEther(finalBalance)} MATIC` });
        }

        // 5. Send Sweep
        const amountToSend = finalBalance - minCost;
        console.log(`[RelayerRecovery] Sweeping ${ethers.formatEther(amountToSend)} MATIC -> ${relayer.faucet_address} `);

        const tx = await wallet.sendTransaction({
            to: relayer.faucet_address,
            value: amountToSend,
            gasPrice: gasPrice,
            gasLimit: gasLimit
        });

        console.log(`[RelayerRecovery] Tx Sent: ${tx.hash} `);
        await tx.wait();

        // 6. Update DB
        await pool.query("UPDATE relayers SET status = 'drained', last_balance = '0' WHERE address = $1", [relayer.address]);

        res.json({ success: true, txHash: tx.hash, amount: ethers.formatEther(amountToSend) });

    } catch (err) {
        console.error("[RelayerRecovery] Error:", err);
        res.status(500).json({ error: err.message });
    }
});

const VERSION = "2.6.1-reactive-unseal";
const PORT_LISTEN = process.env.PORT || 3000;

// ============================================
// AUTOMATIC TRANSACTION MONITOR
// ============================================
async function monitorStuckTransactions() {
    try {
        let recovered = 0;
        // Use execute() for polling if needed, but here we just need to ensure the system doesn't crash on node failure

        // 1. Reset WAITING_CONFIRMATION with no tx_hash (never sent)
        const stuckResult = await pool.query(`
            UPDATE batch_transactions
            SET status = 'PENDING', retry_count = COALESCE(retry_count, 0) + 1
            WHERE status = 'WAITING_CONFIRMATION'
            AND tx_hash IS NULL
            AND updated_at < NOW() - INTERVAL '1 minute'
            RETURNING id
    `);

        if (stuckResult.rowCount > 0) {
            console.log(`[Monitor] ✅ Reset ${stuckResult.rowCount} stuck WAITING_CONFIRMATION → PENDING`);
        }

        // 2. Check blockchain for WAITING_CONFIRMATION with tx_hash
        const waitingRes = await pool.query(`
            SELECT id, tx_hash
            FROM batch_transactions
            WHERE status = 'WAITING_CONFIRMATION'
            AND tx_hash IS NOT NULL
            AND updated_at < NOW() - INTERVAL '2 minutes'
            LIMIT 50
        `);

        for (const tx of waitingRes.rows) {
            try {
                const receipt = await globalRpcManager.execute(async (provider) => {
                    return provider.getTransactionReceipt(tx.tx_hash);
                });
                if (receipt) {
                    const newStatus = receipt.status === 1 ? 'COMPLETED' : 'FAILED';
                    await pool.query(`UPDATE batch_transactions SET status = $1 WHERE id = $2`, [newStatus, tx.id]);
                    recovered++;
                } else {
                    const pendingTx = await provider.getTransaction(tx.tx_hash);
                    if (!pendingTx) {
                        // Dropped from mempool
                        await pool.query(`UPDATE batch_transactions SET status = 'PENDING', tx_hash = NULL WHERE id = $1`, [tx.id]);
                    }
                }
            } catch (err) {
                // RPC error, skip
            }
        }

        if (recovered > 0) {
            console.log(`[Monitor] ✅ Recovered ${recovered} transactions from blockchain`);
        }

        // 3. Reset stale ENVIANDO
        const staleResult = await pool.query(`
            UPDATE batch_transactions
            SET status = 'PENDING', retry_count = COALESCE(retry_count, 0) + 1
            WHERE status = 'ENVIANDO'
            AND updated_at < NOW() - INTERVAL '30 seconds'
            RETURNING id
    `);

        if (staleResult.rowCount > 0) {
            console.log(`[Monitor] ✅ Reset ${staleResult.rowCount} stale ENVIANDO → PENDING`);
        }

    } catch (error) {
        console.error("[Monitor] ❌ Error:", error.message);
    }
}

// Start monitoring loop
setInterval(monitorStuckTransactions, 60000); // Every 60 seconds
console.log("🔄 Transaction Monitor: Enabled (checks every 60s)");

// Debug routes removed and consolidated at top for performance and priority routing

// ═══════════════════════════════════════════════════════════════════════════════
// === INSTANT PAYMENT API ===
// ═══════════════════════════════════════════════════════════════════════════════

const xlsx_ip = require('xlsx');
const INSTANT_CONTRACT_ADDRESS = process.env.INSTANT_PAYMENT_CONTRACT_ADDRESS;

// Helper: get contract instance (full ABI)
function getInstantContract(signerOrProvider) {
    const abi = [
        // Relayer registration
        'function registerRelayer(address coldWallet, address relayer, uint256 deadline, bytes calldata signature) external',
        'function coldWalletRelayer(address coldWallet) external view returns (address)',
        'function getRelayerNonce(address coldWallet) external view returns (uint256)',
        // Policy
        'function activatePolicy(address coldWallet, uint256 totalAmount, uint256 deadline) external',
        'function resetPolicy(address coldWallet) external',
        'function getPolicyBalance(address coldWallet) external view returns (uint256, uint256, uint256, uint256, bool, bool)',
        // Policy limit (admin)
        'function maxPolicyAmount() external view returns (uint256)',
        'function setMaxPolicyAmount(uint256 newMax) external',
        // Transfers
        'function executeTransfer(bytes32 transferId, address from, address to, uint256 amount) external',
        'function isTransferExecuted(bytes32 transferId) external view returns (bool)',
        // Admin
        'function pause() external',
        'function unpause() external',
        // EIP-712 domain separator (for frontend)
        'function domainSeparator() external view returns (bytes32)',
    ];
    return new ethers.Contract(INSTANT_CONTRACT_ADDRESS, abi, signerOrProvider);
}

// ── POST /api/v1/instant/transfer ──────────────────────────────────────────────
// Accepts a transfer order from external API clients
app.post('/api/v1/instant/transfer', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const { transfer_id, destination_wallet, amount_usdc, webhook_url } = req.body;

        if (!transfer_id || !destination_wallet || !amount_usdc) {
            return res.status(400).json({ error: 'transfer_id, destination_wallet and amount_usdc are required' });
        }
        if (!ethers.isAddress(destination_wallet)) {
            return res.status(400).json({ error: 'Invalid destination_wallet address' });
        }
        const amount = parseFloat(amount_usdc);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'amount_usdc must be a positive number' });
        }

        // Check idempotency
        const existing = await pool.query(
            'SELECT transfer_id, status, tx_hash FROM instant_transfers WHERE transfer_id=$1',
            [transfer_id]
        );
        if (existing.rows.length > 0) {
            const ex = existing.rows[0];
            return res.status(409).json({
                error: 'Transfer already exists',
                transfer_id: ex.transfer_id,
                status: ex.status,
                tx_hash: ex.tx_hash
            });
        }

        // Check active policy
        const policy = await pool.query(
            'SELECT * FROM instant_policies WHERE cold_wallet=$1 AND is_active=true',
            [funderAddress]
        );
        if (policy.rows.length === 0) {
            return res.status(402).json({ error: 'No active policy for this funder. Please activate a permit first.' });
        }
        const pol = policy.rows[0];
        const remaining = parseFloat(pol.total_amount) - parseFloat(pol.consumed_amount);
        if (amount > remaining) {
            return res.status(402).json({ error: `Insufficient policy balance. Available: ${remaining.toFixed(6)} USDC` });
        }
        if (new Date(pol.deadline) < new Date()) {
            return res.status(402).json({ error: 'Policy has expired. Please reactivate the permit.' });
        }

        // Insert transfer
        const result = await pool.query(`
            INSERT INTO instant_transfers
              (transfer_id, funder_address, destination_wallet, amount_usdc, status, webhook_url)
            VALUES ($1, $2, $3, $4, 'pending', $5)
            RETURNING *
        `, [transfer_id, funderAddress, destination_wallet.toLowerCase(), amount, webhook_url || null]);

        return res.status(201).json({
            success: true,
            transfer_id,
            status: 'pending',
            message: 'Transfer queued successfully'
        });
    } catch (err) {
        console.error('[IP] POST /transfer error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/transfers ──────────────────────────────────────────────
app.get('/api/v1/instant/transfers', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const isAdmin = req.user.role === 'SUPER_ADMIN';
        const { status, date_from, date_to, wallet, amount, page = 1, limit = 20 } = req.query;

        let where = 'WHERE 1=1';
        const params = [];

        if (!isAdmin) {
            params.push(funderAddress);
            where += ` AND funder_address=$${params.length}`;
        }
        if (status && status !== 'ALL') {
            params.push(status);
            where += ` AND status=$${params.length}`;
        }
        if (date_from) {
            params.push(date_from);
            where += ` AND created_at >= $${params.length}::date`;
        }
        if (date_to) {
            params.push(date_to);
            where += ` AND created_at < ($${params.length}::date + INTERVAL '1 day')`;
        }
        if (wallet) {
            params.push(`%${wallet.toLowerCase()}%`);
            where += ` AND destination_wallet LIKE $${params.length}`;
        }
        if (amount && !isNaN(parseFloat(amount))) {
            const v = parseFloat(amount);
            params.push(v * 0.9, v * 1.1);
            where += ` AND amount_usdc BETWEEN $${params.length - 1} AND $${params.length}`;
        }

        const countRes = await pool.query(`SELECT COUNT(*) FROM instant_transfers ${where}`, params);
        const total = parseInt(countRes.rows[0].count);

        const offset = (parseInt(page) - 1) * parseInt(limit);
        params.push(parseInt(limit), offset);
        const dataRes = await pool.query(`
            SELECT * FROM instant_transfers ${where}
            ORDER BY created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        res.json({
            transfers: dataRes.rows,
            pagination: {
                totalItems: total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (err) {
        console.error('[IP] GET /transfers error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/transfers/export ───────────────────────────────────────
app.get('/api/v1/instant/transfers/export', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const isAdmin = req.user.role === 'SUPER_ADMIN';
        const { status, date_from, date_to, wallet } = req.query;

        let where = 'WHERE 1=1';
        const params = [];
        if (!isAdmin) { params.push(funderAddress); where += ` AND funder_address=$${params.length}`; }
        if (status && status !== 'ALL') { params.push(status); where += ` AND status=$${params.length}`; }
        if (date_from) { params.push(date_from); where += ` AND created_at >= $${params.length}::date`; }
        if (date_to) { params.push(date_to); where += ` AND created_at < ($${params.length}::date + INTERVAL '1 day')`; }
        if (wallet) { params.push(`%${wallet.toLowerCase()}%`); where += ` AND destination_wallet LIKE $${params.length}`; }

        const { rows } = await pool.query(
            `SELECT transfer_id, funder_address, destination_wallet, amount_usdc, status, tx_hash, attempt_count, created_at, confirmed_at, error_message FROM instant_transfers ${where} ORDER BY created_at DESC`,
            params
        );

        const ws = xlsx_ip.utils.json_to_sheet(rows.map(r => ({
            'Transfer ID': r.transfer_id,
            'Funder': r.funder_address,
            'Destino': r.destination_wallet,
            'Monto USDC': parseFloat(r.amount_usdc).toFixed(6),
            'Estado': r.status,
            'TX Hash': r.tx_hash || '',
            'Intentos': r.attempt_count,
            'Creado': r.created_at ? new Date(r.created_at).toISOString() : '',
            'Confirmado': r.confirmed_at ? new Date(r.confirmed_at).toISOString() : '',
            'Error': r.error_message || ''
        })));
        const wb = xlsx_ip.utils.book_new();
        xlsx_ip.utils.book_append_sheet(wb, ws, 'Instant Transfers');
        const buf = xlsx_ip.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="instant_transfers_${Date.now()}.xlsx"`);
        res.send(buf);
    } catch (err) {
        console.error('[IP] GET /transfers/export error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/policy ─────────────────────────────────────────────────
app.get('/api/v1/instant/policy', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const { rows } = await pool.query(
            'SELECT * FROM instant_policies WHERE cold_wallet=$1',
            [funderAddress]
        );
        if (rows.length === 0) return res.json({ hasPolicy: false });
        const p = rows[0];
        res.json({
            hasPolicy: true,
            cold_wallet: p.cold_wallet,
            total_amount: parseFloat(p.total_amount),
            consumed_amount: parseFloat(p.consumed_amount),
            remaining: Math.max(0, parseFloat(p.total_amount) - parseFloat(p.consumed_amount)),
            deadline: p.deadline,
            is_active: p.is_active,
            is_expired: new Date(p.deadline) < new Date(),
            contract_address: INSTANT_CONTRACT_ADDRESS
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/policy/activate ──────────────────────────────────────
// Frontend sends: { totalAmountUsdc, deadlineUnix, permitSig: {v,r,s} } 
// Backend calls activatePolicy on the contract and saves to DB.
app.post('/api/v1/instant/policy/activate', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const { totalAmountUsdc, deadlineUnix } = req.body;

        if (!totalAmountUsdc || !deadlineUnix) {
            return res.status(400).json({ error: 'totalAmountUsdc and deadlineUnix are required' });
        }
        if (!INSTANT_CONTRACT_ADDRESS) {
            return res.status(503).json({ error: 'Instant Payment contract not configured (INSTANT_PAYMENT_CONTRACT_ADDRESS)' });
        }

        const totalAmountRaw = ethers.parseUnits(totalAmountUsdc.toString(), 6);
        const deadline = parseInt(deadlineUnix);

        // Get faucet wallet of the funder to call activatePolicy (the contract owner must call this)
        const provider = globalRpcManager.getProvider();
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, funderAddress);
        const contract = getInstantContract(faucetWallet.connect(provider));

        const tx = await contract.activatePolicy(funderAddress, totalAmountRaw, deadline, {
            gasLimit: 100000,
        });
        await tx.wait(1);

        // Upsert in DB
        await pool.query(`
            INSERT INTO instant_policies (cold_wallet, total_amount, consumed_amount, deadline, is_active, contract_address)
            VALUES ($1, $2, 0, to_timestamp($3), true, $4)
            ON CONFLICT (cold_wallet) DO UPDATE
            SET total_amount=$2, consumed_amount=0, deadline=to_timestamp($3), is_active=true, updated_at=NOW()
        `, [funderAddress, parseFloat(totalAmountUsdc), deadline, INSTANT_CONTRACT_ADDRESS]);

        res.json({ success: true, tx_hash: tx.hash, message: 'Policy activated successfully' });
    } catch (err) {
        console.error('[IP] POST /policy/activate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/policy/reset ─────────────────────────────────────────
app.post('/api/v1/instant/policy/reset', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        await pool.query(
            'UPDATE instant_policies SET is_active=false, updated_at=NOW() WHERE cold_wallet=$1',
            [funderAddress]
        );
        res.json({ success: true, message: 'Policy reset' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/admin/config ──────────────────────────────────────────
// Lee maxPolicyAmount del contrato. El frontend usa este valor para limitar el input.
app.get('/api/v1/instant/admin/config', authenticateToken, async (req, res) => {
    try {
        if (!INSTANT_CONTRACT_ADDRESS) {
            return res.json({ maxPolicyAmountUsdc: 20000, contractReady: false });
        }
        const provider = globalRpcManager.getProvider();
        const contract = getInstantContract(provider);
        const maxRaw = await contract.maxPolicyAmount();
        const maxUsdc = Number(maxRaw) / 1_000_000;
        res.json({
            maxPolicyAmountUsdc: maxUsdc,
            maxPolicyAmountRaw: maxRaw.toString(),
            contractReady: true,
            contractAddress: INSTANT_CONTRACT_ADDRESS
        });
    } catch (err) {
        console.error('[IP] GET /admin/config error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/admin/config ─────────────────────────────────────────
// Actualiza maxPolicyAmount en el contrato. Solo SUPER_ADMIN.
app.post('/api/v1/instant/admin/config', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'SUPER_ADMIN required' });
        if (!INSTANT_CONTRACT_ADDRESS) return res.status(503).json({ error: 'Contract not configured' });

        const { maxPolicyAmountUsdc } = req.body;
        if (!maxPolicyAmountUsdc || isNaN(parseFloat(maxPolicyAmountUsdc)) || parseFloat(maxPolicyAmountUsdc) <= 0) {
            return res.status(400).json({ error: 'maxPolicyAmountUsdc must be a positive number' });
        }

        const newMaxRaw = ethers.parseUnits(maxPolicyAmountUsdc.toString(), 6);

        const provider = globalRpcManager.getProvider();
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, req.user.address);
        const contract = getInstantContract(faucetWallet.connect(provider));

        const tx = await contract.setMaxPolicyAmount(newMaxRaw, { gasLimit: 80000 });
        await tx.wait(1);

        console.log(`[IP] maxPolicyAmount updated to ${maxPolicyAmountUsdc} USDC by ${req.user.address}. TX: ${tx.hash}`);
        res.json({
            success: true,
            tx_hash: tx.hash,
            maxPolicyAmountUsdc: parseFloat(maxPolicyAmountUsdc),
            message: `Max policy amount updated to ${maxPolicyAmountUsdc} USDC`
        });
    } catch (err) {
        console.error('[IP] POST /admin/config error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/admin/pause ──────────────────────────────────────────
app.post('/api/v1/instant/admin/pause', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'SUPER_ADMIN required' });
        if (!INSTANT_CONTRACT_ADDRESS) return res.status(503).json({ error: 'Contract not configured' });
        const provider = globalRpcManager.getProvider();
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, req.user.address);
        const contract = getInstantContract(faucetWallet.connect(provider));
        const tx = await contract.pause({ gasLimit: 60000 });
        await tx.wait(1);
        res.json({ success: true, tx_hash: tx.hash });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/admin/unpause ────────────────────────────────────────
app.post('/api/v1/instant/admin/unpause', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'SUPER_ADMIN required' });
        if (!INSTANT_CONTRACT_ADDRESS) return res.status(503).json({ error: 'Contract not configured' });
        const provider = globalRpcManager.getProvider();
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, req.user.address);
        const contract = getInstantContract(faucetWallet.connect(provider));
        const tx = await contract.unpause({ gasLimit: 60000 });
        await tx.wait(1);
        res.json({ success: true, tx_hash: tx.hash });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/webhook/register ─────────────────────────────────────
app.post('/api/v1/instant/webhook/register', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const { webhook_url } = req.body;
        if (!webhook_url) return res.status(400).json({ error: 'webhook_url is required' });
        // Store webhook_url on all pending/future transfers for this funder via default
        // (Stored per-transfer at creation time. This endpoint sets a preference.)
        await pool.query(`
            INSERT INTO instant_policies (cold_wallet, total_amount, deadline, is_active)
            VALUES ($1, 0, NOW(), false)
            ON CONFLICT (cold_wallet) DO UPDATE SET updated_at=NOW()
        `, [funderAddress]);
        // Update existing pending transfers to include webhook_url
        await pool.query(
            'UPDATE instant_transfers SET webhook_url=$1 WHERE funder_address=$2 AND status=\'pending\'',
            [webhook_url, funderAddress]
        );
        res.json({ success: true, webhook_url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/webhook/logs ──────────────────────────────────────────
app.get('/api/v1/instant/webhook/logs', authenticateToken, async (req, res) => {
    try {
        const funderAddress = req.user.address.toLowerCase();
        const isAdmin = req.user.role === 'SUPER_ADMIN';
        let query = `
            SELECT wl.* FROM instant_webhook_logs wl
            JOIN instant_transfers t ON t.transfer_id = wl.transfer_id
        `;
        const params = [];
        if (!isAdmin) {
            params.push(funderAddress);
            query += ` WHERE t.funder_address=$1`;
        }
        query += ' ORDER BY wl.created_at DESC LIMIT 100';
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/relayer/status ─────────────────────────────────────────
// Returns on-chain relayer registration status for the authenticated cold wallet.
app.get('/api/v1/instant/relayer/status', authenticateToken, async (req, res) => {
    try {
        const coldWallet = req.user.address.toLowerCase();
        if (!INSTANT_CONTRACT_ADDRESS) {
            return res.json({ registered: false, relayer: null, contractReady: false });
        }
        const provider = globalRpcManager.getProvider();
        const contract = getInstantContract(provider);
        const registeredRelayer = await contract.coldWalletRelayer(coldWallet);
        const isRegistered = registeredRelayer && registeredRelayer !== ethers.ZeroAddress;

        // Also fetch what the DB says the faucet should be
        const faucet = await faucetService.getFaucetWallet(pool, provider, coldWallet);

        res.json({
            registered: isRegistered,
            relayer: isRegistered ? registeredRelayer : null,
            expectedFaucet: faucet?.address || null,
            contractReady: true,
            contractAddress: INSTANT_CONTRACT_ADDRESS
        });
    } catch (err) {
        console.error('[IP] GET /relayer/status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /api/v1/instant/relayer/nonce ──────────────────────────────────────────
// Retorna el nonce actual de registro de relayer. El frontend lo incluye en la firma EIP-712.
app.get('/api/v1/instant/relayer/nonce', authenticateToken, async (req, res) => {
    try {
        const coldWallet = req.user.address.toLowerCase();
        if (!INSTANT_CONTRACT_ADDRESS) {
            return res.json({ nonce: 0, contractReady: false });
        }
        const provider = globalRpcManager.getProvider();
        const contract = getInstantContract(provider);
        const nonce = await contract.getRelayerNonce(coldWallet);
        res.json({ nonce: Number(nonce), contractReady: true });
    } catch (err) {
        console.error('[IP] GET /relayer/nonce error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/v1/instant/relayer/register ───────────────────────────────────────
// Receives an EIP-712 signature from the cold wallet and submits it to the contract.
// The faucet wallet pays the gas for registerRelayer().
app.post('/api/v1/instant/relayer/register', authenticateToken, async (req, res) => {
    try {
        const coldWallet = req.user.address.toLowerCase();
        const { deadline, signature } = req.body;

        if (!deadline || !signature) {
            return res.status(400).json({ error: 'deadline and signature are required' });
        }
        if (!INSTANT_CONTRACT_ADDRESS) {
            return res.status(503).json({ error: 'Instant Payment contract not configured' });
        }

        const provider = globalRpcManager.getProvider();
        const faucetWallet = await faucetService.getFaucetWallet(pool, provider, coldWallet);
        const contract = getInstantContract(faucetWallet.connect(provider));

        console.log(`[IP] Registering relayer: coldWallet=${coldWallet}, relayer=${faucetWallet.address}`);

        const tx = await contract.registerRelayer(
            coldWallet,
            faucetWallet.address,
            parseInt(deadline),
            signature,
            { gasLimit: 100000 }
        );
        await tx.wait(1);

        console.log(`[IP] Relayer registered on-chain. TX: ${tx.hash}`);
        res.json({
            success: true,
            tx_hash: tx.hash,
            cold_wallet: coldWallet,
            relayer: faucetWallet.address
        });
    } catch (err) {
        console.error('[IP] POST /relayer/register error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Initialize Instant Relayer Engine ────────────────────────────────────────
if (INSTANT_CONTRACT_ADDRESS) {
    const instantRelayer = new InstantRelayerEngine({
        pool,
        rpcManager: globalRpcManager,
        contractAddress: INSTANT_CONTRACT_ADDRESS,
        faucetService,
        encryption: null
    });
    // Start after DB is ready
    setTimeout(() => instantRelayer.start(), 8000);
    console.log('[InstantPayment] Relayer engine scheduled to start in 8s');
} else {
    console.warn('[InstantPayment] ⚠️  INSTANT_PAYMENT_CONTRACT_ADDRESS not set — relayer engine disabled');
}

// ═══════════════════════════════════════════════════════════════════════════════
// END INSTANT PAYMENT API
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT_LISTEN, () => {
    console.log(`Server is running on port ${PORT_LISTEN} `);
    console.log(`🚀 Version: ${VERSION} (Self - Healing & Performance Record)`);

    // Run first check immediately
    setTimeout(monitorStuckTransactions, 5000); // Wait 5s for server to be ready
});




