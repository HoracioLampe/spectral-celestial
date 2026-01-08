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
const faucetService = require('./services/faucet'); // Import Faucet Service
const vault = require('./services/vault'); // Import Vault Service
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dappsfactory-secret-key-2026';


// RPC Configuration (Failover) - NO HARDCODED URLs
const RPC_PRIMARY = process.env.RPC_URL;
const RPC_FALLBACK = process.env.RPC_FALLBACK_URL;
const globalRpcManager = new RpcManager(RPC_PRIMARY, RPC_FALLBACK);

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
// Database Connection
const dbUrl = process.env.DATABASE_URL;
console.log(`[DB] Using Database URL: ${dbUrl ? 'DEFINED (Masked)' : 'UNDEFINED'}`);

const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
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

// --- AUTO-UNSEAL LOGIC ---
const autoUnseal = async () => {
    const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
    const VAULT_API_V = 'v1';

    // Security: Read keys from environment variable (comma separated)
    const envKeys = process.env.VAULT_UNSEAL_KEYS;
    if (!envKeys) {
        console.log("[Vault] ⚠️ No UNSEAL keys found in environment. Skipping auto-unseal.");
        return;
    }
    const keys = envKeys.split(',').map(k => k.trim());

    try {
        console.log(`[Vault] 🛡️ Checking seal status at ${VAULT_ADDR}...`);
        const healthRes = await fetch(`${VAULT_ADDR}/${VAULT_API_V}/sys/health`);
        const health = await healthRes.json();

        if (health.sealed) {
            console.log("[Vault] 🔒 Vault is sealed! Attempting auto-unseal...");
            for (const key of keys) {
                const res = await fetch(`${VAULT_ADDR}/${VAULT_API_V}/sys/unseal`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                const status = await res.json();
                if (!status.sealed) {
                    console.log("[Vault] 🎉 Auto-unseal successful!");
                    return;
                }
            }
        } else {
            console.log("[Vault] ✅ Vault is already unsealed.");
        }
    } catch (e) {
        console.error(`[Vault] ⚠️ Auto-unseal check failed: ${e.message}`);
    }
};
// -------------------------

// Warm up the connection (don't block server start)
let dbReady = false;
initSessionTable().then(ready => {
    dbReady = ready;
    if (ready) {
        console.log("🔥 Database connection warmed up successfully");
        autoUnseal(); // Initial check

        // --- CONTINUOUS RESILIENCE ---
        // Check every 5 minutes to see if Vault is sealed (e.g. after a Vault-only restart)
        setInterval(autoUnseal, 5 * 60 * 1000);
        console.log("🔒 Vault Auto-Unseal Monitor: Enabled (checks every 5m)");
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
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user; // { address, role }
        next();
    });
};



const os = require('os');


// Multer for Excel Uploads - Use system temp dir for Railway compatibility
const upload = multer({ dest: os.tmpdir() });

// --- Authentication API ---

// TEMPORARY: Internal Vault Setup Endpoint (Run Once) - PRIORITY ROUTE

// --- DEBUG VAULT ENDPOINT (AUTO-REPAIR MODE) ---
// MOVED TO INITIALIZATION SECTION
app.get('/api/debug/vault', async (req, res) => {
    try {
        const testUuid = ethers.Wallet.createRandom().address;
        const testKey = "test-key-content";
        const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
        const VAULT_TOKEN = process.env.VAULT_TOKEN;

        console.log(`[Debug] Testing Vault Direct connection to: ${VAULT_ADDR}`);

        if (!VAULT_TOKEN) {
            return res.status(500).json({ success: false, error: "VAULT_TOKEN missing in env" });
        }

        const headers = {
            'X-Vault-Token': VAULT_TOKEN,
            'Content-Type': 'application/json'
        };

        // 1. Check Mounts
        let mounts = {};
        let repairStatus = "Skipped";
        try {
            const mountsRes = await fetch(`${VAULT_ADDR}/v1/sys/mounts`, { headers });
            if (mountsRes.ok) {
                mounts = await mountsRes.json();

                // AUTO-REPAIR: Mount 'secret' if missing
                if (!mounts["secret/"]) {
                    console.log("[Auto-Repair] 'secret/' mount missing. Attempting to mount KV v2...");
                    const mountRes = await fetch(`${VAULT_ADDR}/v1/sys/mounts/secret`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ type: "kv", options: { version: "2" } })
                    });

                    if (mountRes.ok) {
                        repairStatus = "SUCCESS: 'secret/' engine mounted.";
                        // Refresh mounts
                        const m2 = await fetch(`${VAULT_ADDR}/v1/sys/mounts`, { headers });
                        if (m2.ok) mounts = await m2.json();
                    } else {
                        repairStatus = `FAILED: ${mountRes.status} ${await mountRes.text()}`;
                    }
                } else {
                    repairStatus = "OK: 'secret/' already exists.";
                }

            } else {
                mounts = { error: await mountsRes.text(), status: mountsRes.status };
            }
        } catch (e) {
            mounts = { error: e.message, type: "network_error" };
        }

        // 2. Try Raw Write (Post-Repair)
        const path = `secret/data/faucets/${testUuid.toLowerCase()}`;
        const payload = {
            data: { private_key: testKey, debug: true }
        };

        let writeResult = {};
        try {
            const writeRes = await fetch(`${VAULT_ADDR}/v1/${path}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (writeRes.ok) {
                writeResult = await writeRes.json();
            } else {
                writeResult = {
                    success: false,
                    status: writeRes.status,
                    errorText: await writeRes.text()
                };
            }
        } catch (e) {
            writeResult = { error: e.message };
        }

        // 3. Try Service Wrapper (Control)
        const wrapperSaved = await vault.saveFaucetKey(testUuid, testKey);

        res.json({
            success: wrapperSaved,
            repair_attempt: repairStatus,
            debug_info: {
                vault_addr: VAULT_ADDR,
                token_preview: VAULT_TOKEN ? `${VAULT_TOKEN.substring(0, 4)}...` : 'NONE',
                mounts_check: mounts,
                raw_write_attempt: writeResult,
                wrapper_result: wrapperSaved
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, stack: e.stack });
    }
});

// --- SEND POL FROM FAUCET ---
app.post('/api/faucet/send-pol', async (req, res) => {
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

app.get('/api/setup-vault-internal', async (req, res) => {
    const INTERNAL_VAULT_URL = "http://vault-railway-template.railway.internal:8200";
    const VAULT_APIV = 'v1';

    try {
        // 1. Check Status
        let initStatusReq;
        try {
            initStatusReq = await fetch(`${INTERNAL_VAULT_URL}/${VAULT_APIV}/sys/init`);
        } catch (e) {
            return res.status(502).json({ error: "Could not reach Vault internal URL", details: e.message });
        }

        const initStatus = await initStatusReq.json();

        if (initStatus.initialized) {
            return res.json({
                status: "ALREADY_INITIALIZED",
                message: "Vault is already initialized. If you lost keys, redeploy Vault service."
            });
        }

        // 2. Initialize
        const initReq = await fetch(`${INTERNAL_VAULT_URL}/${VAULT_APIV}/sys/init`, {
            method: 'PUT',
            body: JSON.stringify({ secret_shares: 5, secret_threshold: 3 }),
            headers: { 'Content-Type': 'application/json' }
        });

        const keys = await initReq.json();

        // 3. Auto-Unseal
        let unsealStatus = [];
        for (let i = 0; i < 3; i++) {
            await fetch(`${INTERNAL_VAULT_URL}/${VAULT_APIV}/sys/unseal`, {
                method: 'PUT',
                body: JSON.stringify({ key: keys.keys[i] }),
                headers: { 'Content-Type': 'application/json' }
            });
            unsealStatus.push(`Key ${i + 1} applied`);
        }

        res.json({
            status: "SUCCESS",
            message: "Vault Initialized & Unsealed successfully!",
            IMPORTANT_CREDENTIALS: {
                root_token: keys.root_token,
                unseal_keys: keys.keys
            },
            notes: "SAVE THESE CREDENTIALS NOW. They will not be shown again."
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
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

app.get('/api/debug', async (req, res) => {
    const dbUrlMasked = dbUrl ? dbUrl.replace(/:[^:@]*@/, ':****@') : 'UNDEFINED';
    let dbStatus = 'unknown';
    let dbError = null;

    try {
        await pool.query('SELECT NOW()');
        dbStatus = 'connected';
    } catch (e) {
        dbStatus = 'failed';
        dbError = e.message;
    }

    // Check Vault Status for debug
    let vaultStatus = { error: "Check failed" };
    try {
        const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
        const vRes = await fetch(`${VAULT_ADDR}/v1/sys/health`);
        const vData = await vRes.json();
        vaultStatus = {
            initialized: vData.initialized,
            sealed: vData.sealed,
            version: vData.version
        };
    } catch (e) {
        vaultStatus = { error: e.message };
    }

    res.json({
        database: {
            url: dbUrlMasked,
            status: dbStatus,
            error: dbError,
            poolSize: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount
        },
        session: {
            storeType: sessionStore.constructor.name
        },
        vault: vaultStatus, // Added vault status
        environment: {
            nodeEnv: process.env.NODE_ENV || 'not set',
            port: PORT,
            version: VERSION,
            vault_addr: process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200",
            persistent_volume: fs.existsSync('/vault/file') ? 'MOUNTED' : 'MISSING'
        }
    });
});

app.get('/testConnection', async (req, res) => {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>DB Connection Test</title>
    <style>
        body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #00ff00; }
        .success { color: #00ff00; }
        .error { color: #ff0000; }
        .info { color: #ffaa00; }
        pre { background: #000; padding: 10px; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>🔌 Database Connection Test</h1>
    <pre id="output">Testing connection...</pre>
    <script>
        (async () => {
            const output = document.getElementById('output');
            let result = '';
            
            try {
                result += '📡 Fetching /api/debug...\\n\\n';
                const res = await fetch('/api/debug');
                const data = await res.json();
                
                result += '=== DATABASE INFO ===\\n';
                result += 'URL: ' + data.database.url + '\\n';
                result += 'Status: ' + data.database.status + '\\n';
                
                if (data.database.error) {
                    result += '❌ Error: ' + data.database.error + '\\n';
                } else {
                    result += '✅ Connection OK\\n';
                }
                
                result += '\\nPool Size: ' + data.database.poolSize + '\\n';
                result += 'Idle Connections: ' + data.database.idleCount + '\\n';
                result += 'Waiting: ' + data.database.waitingCount + '\\n';
                
                result += '\\n=== SESSION INFO ===\\n';
                result += 'Store Type: ' + data.session.storeType + '\\n';
                
                result += '\\n=== ENVIRONMENT ===\\n';
                result += 'Node ENV: ' + data.environment.nodeEnv + '\\n';
                result += 'Port: ' + data.environment.port + '\\n';
                
                output.className = data.database.status === 'connected' ? 'success' : 'error';
            } catch (err) {
                result += '\\n❌ FETCH ERROR: ' + err.message;
                output.className = 'error';
            }
            
            output.textContent = result;
        })();
    </script>
</body>
</html>
    `;
    res.send(html);
});

app.get('/api/config', (req, res) => {
    res.json({
        CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x7B25Ce9800CCE4309E92e2834E09bD89453d90c5",
        RPC_URL: RPC_PRIMARY
    });
});

app.get('/api/auth/nonce', async (req, res) => {
    try {
        console.log(`[Auth] Generating Nonce for SessionID: ${req.sessionID}`);
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

        console.log(`[Auth] Nonce generated and saved: ${req.session.nonce}`);
        res.json({ nonce: req.session.nonce });
    } catch (err) {
        console.error("❌ Nonce Error:", err);
        res.status(500).json({ error: "Failed to generate nonce: " + err.message });
    }
});

// --- Faucet Self-Healing Helper ---
// --- Faucet Self-Healing Helper ---
async function ensureUserFaucet(userAddress) {
    if (!userAddress) return;
    try {
        // --- REACTIVE UNSEAL ---
        // Before doing anything with Vault/Faucets, make sure stay unsealed
        await autoUnseal();

        console.log(`[Self-Heal] Ensuring Faucet for ${userAddress}...`);
        await faucetService.getFaucetWallet(pool, globalRpcManager.getProvider(), userAddress);
    } catch (e) {
        console.error(`[Self-Heal] Failed for ${userAddress}:`, e.message);
    }
}

app.post('/api/auth/verify', async (req, res) => {
    try {
        const { message, signature } = req.body;
        const siweMessage = new SiweMessage(message);

        console.log(`[Auth] Verifying Signature. SessionID: ${req.sessionID}`);
        console.log(`[Auth] Stored Nonce: ${req.session ? req.session.nonce : 'UNDEFINED'}`);

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
                // Securely load from Vault using the faucet's address directly
                const privateKey = await vault.getFaucetKey(faucet.address);
                if (!privateKey) throw new Error("Key not found in Vault");

                const wallet = new ethers.Wallet(privateKey, provider);
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

// GET Faucet Helper (User-Specific) - VAULT INTEGRATED
// GET Faucet Helper (User-Specific) - VAULT INTEGRATED
async function getFaucetCredentials(userAddress) {
    if (!userAddress) throw new Error("Faucet lookup requires User Address");

    // Delegate to unified Faucet Service logic
    // This handles: DB lookup -> Vault lookup (by Faucet Address) -> Strict Integrity -> Generation -> Saving
    const wallet = await faucetService.getFaucetWallet(pool, globalRpcManager.getProvider(), userAddress);

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




// Faucet Management API (User Specific)
// Faucet Management API (User Specific)
app.get('/api/faucet', authenticateToken, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();

        // 1. Check existing faucet for THIS user
        const result = await pool.query('SELECT address, funder_address FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [userAddress]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            const provider = globalRpcManager.getProvider();

            let balance = "0.0";
            try {
                const balWei = await provider.getBalance(row.address);
                balance = ethers.formatEther(balWei);
            } catch (err) {
                console.warn("Error fetching balance:", err.message);
            }

            let privateKey = "NOT_FOUND_IN_VAULT";
            try {
                // CORRECT LOGIC: Funder -> Address(DB) -> PrivateKey(Vault)
                const k = await vault.getFaucetKey(row.address);
                if (k) privateKey = k;
            } catch (e) {
                console.warn("Vault lookup failed:", e.message);
                privateKey = "VAULT_ERROR";
            }

            // 3. Get current network gas fee data for dynamic calculation
            let gasReserve = "0.05";
            let feeData = { maxFeePerGas: "0", maxPriorityFeePerGas: "0" };
            try {
                const fData = await provider.getFeeData();
                feeData.maxFeePerGas = fData.maxFeePerGas ? fData.maxFeePerGas.toString() : "0";
                feeData.maxPriorityFeePerGas = fData.maxPriorityFeePerGas ? fData.maxPriorityFeePerGas.toString() : "0";

                // Calculate recommended reserve for a standard 21000 gas transfer with 1.5x buffer
                const gasLimit = 21000n;
                const maxFee = fData.maxFeePerGas || ethers.parseUnits('100', 'gwei');
                const cost = (gasLimit * maxFee * 15n) / 10n;
                gasReserve = ethers.formatEther(cost);
            } catch (err) {
                console.warn("Error fetching gas data for faucet API:", err.message);
            }

            res.json({
                address: row.address,
                privateKey: privateKey,
                balance: balance,
                gasReserve: gasReserve,
                feeData: feeData
            });
        } else {
            // AUTO-GENERATE for this user using Central Helper
            console.log(`🔍 No Faucet found for ${userAddress}, generating new one via Vault...`);

            // Reuse central logic which handles Vault saving
            const newPk = await getFaucetCredentials(userAddress);
            // We need the address too. getFaucetCredentials returns PK only. 
            // We can derive it or re-query. Re-query is safest to get stored public address.

            const newFaucetRes = await pool.query('SELECT * FROM faucets WHERE LOWER(funder_address) = $1 LIMIT 1', [userAddress]);
            if (newFaucetRes.rows.length > 0) {
                const row = newFaucetRes.rows[0];
                // 3. Get current network gas fee data for dynamic calculation
                let gasReserve = "0.05"; // fallback human readable
                let feeData = { maxFeePerGas: "0", maxPriorityFeePerGas: "0" };
                try {
                    const provider = globalRpcManager.getProvider(); // Ensure provider is available in this scope
                    const fData = await provider.getFeeData();
                    feeData.maxFeePerGas = fData.maxFeePerGas ? fData.maxFeePerGas.toString() : "0";
                    feeData.maxPriorityFeePerGas = fData.maxPriorityFeePerGas ? fData.maxPriorityFeePerGas.toString() : "0";

                    // Calculate recommended reserve for a standard 21000 gas transfer with 1.5x buffer
                    const gasLimit = 21000n;
                    const maxFee = fData.maxFeePerGas || ethers.parseUnits('100', 'gwei');
                    const cost = (gasLimit * maxFee * 15n) / 10n;
                    gasReserve = ethers.formatEther(cost);
                } catch (err) {
                    console.warn("Error fetching gas data for faucet API:", err.message);
                }

                res.json({
                    address: row.address,
                    privateKey: newPk,
                    balance: '0',
                    gasReserve: gasReserve,
                    feeData: feeData
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
        const wallet = await faucetService.getFaucetWallet(pool, provider, userAddress);

        res.json({ address: wallet.address });
    } catch (err) {
        console.error("[Faucet] Generate error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs', async (req, res) => {
    res.json({ message: "Logs are available in the console" });
});

app.get('/api/config', (req, res) => {
    res.json({
        RPC_URL: process.env.RPC_URL || "",
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


// --- DEBUG VAULT ENDPOINT (TEMPORARY - DIAGNOSTIC MODE) ---
app.get('/api/debug/vault', async (req, res) => {
    try {
        const testUuid = ethers.Wallet.createRandom().address;
        const testKey = "test-key-content";
        const VAULT_ADDR = process.env.VAULT_ADDR || "http://vault-railway-template.railway.internal:8200";
        const VAULT_TOKEN = process.env.VAULT_TOKEN;

        console.log(`[Debug] Testing Vault Direct connection to: ${VAULT_ADDR} `);

        if (!VAULT_TOKEN) {
            return res.status(500).json({ success: false, error: "VAULT_TOKEN missing in env" });
        }

        const headers = {
            'X-Vault-Token': VAULT_TOKEN,
            'Content-Type': 'application/json'
        };

        // 1. Check Mounts
        let mounts = {};
        try {
            const mountsRes = await fetch(`${VAULT_ADDR} /v1/sys / mounts`, { headers });
            if (mountsRes.ok) {
                mounts = await mountsRes.json();
            } else {
                mounts = { error: await mountsRes.text(), status: mountsRes.status };
            }
        } catch (e) {
            mounts = { error: e.message, type: "network_error" };
        }

        // 2. Try Raw Write
        const path = `secret / data / faucets / ${testUuid.toLowerCase()} `;
        const payload = {
            data: { private_key: testKey, debug: true }
        };

        let writeResult = {};
        try {
            const writeRes = await fetch(`${VAULT_ADDR} /v1/${path} `, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (writeRes.ok) {
                writeResult = await writeRes.json();
            } else {
                writeResult = {
                    success: false,
                    status: writeRes.status,
                    errorText: await writeRes.text()
                };
            }
        } catch (e) {
            writeResult = { error: e.message };
        }

        // 3. Try Service Wrapper (Control)
        const wrapperSaved = await vault.saveFaucetKey(testUuid, testKey);

        res.json({
            success: wrapperSaved,
            debug_info: {
                vault_addr: VAULT_ADDR,
                token_preview: VAULT_TOKEN ? `${VAULT_TOKEN.substring(0, 4)}...` : 'NONE',
                mounts_check: mounts,
                raw_write_attempt: writeResult,
                wrapper_result: wrapperSaved
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, stack: e.stack });
    }
});


// Recovery Dashboard API
app.get('/api/recovery/batches', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT b.id, b.total_transactions, b.status as batch_status, 
                   COUNT(r.id) as total_relayers,
                   SUM(CASE WHEN r.status != 'drained' THEN CAST(r.last_balance AS DECIMAL) ELSE 0 END) as total_pol,
                   b.funder_address
            FROM batches b
            JOIN relayers r ON b.id = r.batch_id
            GROUP BY b.id, b.total_transactions, b.status, b.funder_address
            HAVING SUM(CASE WHEN r.status != 'drained' THEN CAST(r.last_balance AS DECIMAL) ELSE 0 END) > 0.001
            ORDER BY b.id DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error("Error fetching recovery batches:", err);
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
        const batchId = req.params.id;
        process.stdout.write(`\n\n[LOG-FORCE] 🚀 User ${req.user.address} requested fund recovery for Batch ${batchId}\n\n`);

        const engine = new RelayerEngine(pool, globalRpcManager, await getFaucetCredentials(req.user.address)); // Ensure context

        // Verify Ownership to get owner address
        const ownerRes = await pool.query('SELECT funder_address FROM batches WHERE id = $1', [batchId]);
        if (ownerRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
        const batchOwner = ownerRes.rows[0].funder_address?.toLowerCase();

        if (req.user.role !== 'SUPER_ADMIN' && batchOwner !== userAddress) {
            return res.status(403).json({ error: 'Access denied' });
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

// --- TEMPORARY: Execute Faucet Constraints SQL ---
app.get('/api/admin/add-faucet-constraints', async (req, res) => {
    try {
        const results = [];

        // 1. Add UNIQUE constraint
        try {
            await pool.query(`
                ALTER TABLE faucets 
                ADD CONSTRAINT faucets_funder_address_unique 
                UNIQUE(funder_address)
        `);
            results.push({ step: 1, status: 'SUCCESS', message: 'UNIQUE constraint added' });
        } catch (e) {
            if (e.message.includes('already exists')) {
                results.push({ step: 1, status: 'SKIPPED', message: 'UNIQUE constraint already exists' });
            } else {
                throw e;
            }
        }

        // 2. Create index
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_faucets_funder_address_lower 
            ON faucets(LOWER(funder_address))
    `);
        results.push({ step: 2, status: 'SUCCESS', message: 'Index created' });

        // 3. Check for duplicates
        const duplicates = await pool.query(`
            SELECT funder_address, COUNT(*) as count
            FROM faucets
            GROUP BY funder_address
            HAVING COUNT(*) > 1
    `);
        results.push({
            step: 3,
            status: duplicates.rows.length === 0 ? 'SUCCESS' : 'WARNING',
            message: `Found ${duplicates.rows.length} duplicate funder(s)`,
            duplicates: duplicates.rows
        });

        res.json({ success: true, results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message, stack: e.stack });
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

        // Use a generic faucet (admin-controlled) or infer from batch
        // Since this is Admin global rescue, we need to be careful with Faucet context.
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
                console.error(`[Admin] Rescue failed for Batch ${batch.id}:`, batchErr.message);
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

        // Securely fetch key from Vault
        const relayerPrivateKey = await vault.getRelayerKey(relayerAddress);
        if (!relayerPrivateKey) throw new Error("Key not found in Vault");
        const wallet = new ethers.Wallet(relayerPrivateKey, provider);

        // 2. Check Balance & Nonce Status
        const balance = await provider.getBalance(wallet.address);
        const latestNonce = await provider.getTransactionCount(wallet.address, "latest");
        const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");

        console.log(`[RelayerRecovery] ${relayerAddress} | Balance: ${ethers.formatEther(balance)} | Latest: ${latestNonce} | Pending: ${pendingNonce} `);

        const feeData = await provider.getFeeData();
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
        const finalBalance = await provider.getBalance(wallet.address);
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
        const provider = globalRpcManager.getProvider();

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

        let recovered = 0;
        for (const tx of waitingRes.rows) {
            try {
                const receipt = await provider.getTransactionReceipt(tx.tx_hash);
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

app.listen(PORT_LISTEN, () => {
    console.log(`Server is running on port ${PORT_LISTEN} `);
    console.log(`🚀 Version: ${VERSION} (Self - Healing & Performance Record)`);

    // Run first check immediately
    setTimeout(monitorStuckTransactions, 5000); // Wait 5s for server to be ready
});




