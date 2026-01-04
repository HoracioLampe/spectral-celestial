const API_TRANSACTIONS = '/api/transactions'; // v3.1.0-deploy-force
let APP_CONFIG = { RPC_URL: '', WS_RPC_URL: '' };
const BATCCH_PAGE_SIZE = 10;
const TIMEZONE_CONFIG = { timeZone: 'America/Argentina/Buenos_Aires' };
let currentBatchPage = 1;

// Global Error Handler for debugging
window.onerror = function (msg, url, line, col, error) {
    console.error(`[Global Error] ${msg} at ${url}:${line}:${col}`, error);
    alert(`Error detectado: ${msg}\n\nRevisa la consola para más detalles.`);
    return false;
};
window.onunhandledrejection = function (event) {
    console.error('[Unhandled Rejection]', event.reason);
};

let AUTH_TOKEN = localStorage.getItem('jwt_token');



async function authenticatedFetch(url, options = {}) {
    const token = AUTH_TOKEN || localStorage.getItem('jwt_token');
    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    return fetch(url, { ...options, headers });
}



async function getConfig() {
    try {
        const res = await fetch('/api/config');
        APP_CONFIG = await res.json();
    } catch (e) {
        console.error("Error fetching config:", e);
    }
}

function getExplorerUrl(address) {
    // We can expand this to check for network in config if needed
    return `https://polygonscan.com/address/${address}`;
}

// Initialize config
getConfig();

// --- Faucet Monitoring ---
async function checkFaucetStatus() {
    const btnSetup = document.getElementById('btnSetupRelayers');
    const btnExecute = document.getElementById('btnExecuteBatch');
    const faucetStatus = document.getElementById('modalFaucetStatus');
    const faucetBalanceSpan = document.getElementById('faucetBalance');
    const faucetKeySpan = document.getElementById('faucetKey');

    // Sidebar Faucet Elements
    const sideFaucetLink = document.getElementById('sidebarFaucetLink');
    const sideFaucetBalance = document.getElementById('sidebarFaucetBalance');
    const btnCopyFaucetSide = document.getElementById('btnCopyFaucetSidebar');

    // Main Page elements
    const mainBalance = document.getElementById('mainFaucetBalance');

    try {
        const response = await authenticatedFetch('/api/faucet');
        if (response.status === 401 || response.status === 403) return; // Silent fail if not auth

        const data = await response.json();

        if (data.address) {
            const shortAddr = `${data.address.substring(0, 6)}...${data.address.substring(38)}`;

            // Faucet Modal Link
            const modalLink = document.getElementById('faucetModalLink');
            if (modalLink) {
                modalLink.textContent = `${data.address} ➔ `;
                modalLink.href = getExplorerUrl(data.address);
                modalLink.dataset.address = data.address;
            }

            if (faucetBalanceSpan) faucetBalanceSpan.textContent = `${parseFloat(data.balance).toFixed(4)} POL`;
            if (faucetKeySpan) faucetKeySpan.textContent = data.privateKey || "---";

            // Update Sidebar Faucet Info
            if (sideFaucetLink) {
                sideFaucetLink.textContent = shortAddr;
                sideFaucetLink.href = getExplorerUrl(data.address);
            }
            if (sideFaucetBalance) {
                sideFaucetBalance.textContent = parseFloat(data.balance).toFixed(4);
            }
            if (btnCopyFaucetSide) {
                btnCopyFaucetSide.onclick = () => {
                    navigator.clipboard.writeText(data.address);
                    const original = btnCopyFaucetSide.innerHTML;
                    btnCopyFaucetSide.innerHTML = "✅";
                    setTimeout(() => btnCopyFaucetSide.innerHTML = original, 2000);
                }
            }

            // Main Faucet Link
            const mainLink = document.getElementById('mainFaucetLink');
            if (mainLink) {
                mainLink.textContent = `${shortAddr} ➔ `;
                mainLink.href = getExplorerUrl(data.address);
                mainLink.dataset.address = data.address;
            }
            if (mainBalance) mainBalance.textContent = `${parseFloat(data.balance).toFixed(4)} POL`;

            const balance = parseFloat(data.balance);
            if (balance <= 0) {
                if (btnSetup) {
                    btnSetup.disabled = true;
                    btnSetup.title = "El Faucet no tiene POL";
                    btnSetup.style.opacity = "0.5";
                }
            } else {
                if (btnSetup) {
                    btnSetup.disabled = false;
                    btnSetup.title = "Configurar Relayers";
                    btnSetup.style.opacity = "1";
                }
            }

            if (faucetStatus) {
                faucetStatus.className = "alert alert-success";
                faucetStatus.textContent = "Faucet Activo";
            }
        } else {
            if (btnSetup) btnSetup.disabled = true;
            if (faucetStatus) {
                faucetStatus.textContent = "❌ No hay Faucet. Haz clic en 'Gestione Faucet' > 'Generar'.";
                faucetStatus.style.color = "#ef4444";
            }
            const mainLink = document.getElementById('mainFaucetLink');
            if (mainLink) mainLink.textContent = "---";
        }
    } catch (err) {
        console.error('Error checking faucet:', err);
        const mainLink = document.getElementById('mainFaucetLink');
        if (mainLink) mainLink.textContent = "⚠️ Error RPC";
    }
}

window.generateFaucet = async () => {
    if (!confirm("¿Deseas generar una nueva Faucet? Esto creará una dirección única en la BD.")) return;
    try {
        const response = await fetch('/api/faucet/generate', { method: 'POST' });
        const res = await response.json();
        if (response.ok) {
            alert("✅ Faucet generada con éxito: " + res.address);
            checkFaucetStatus();
        } else {
            alert("❌ Error: " + res.error);
        }
    } catch (err) {
        alert("❌ Error de conexión");
    }
};

window.copyFaucetAddress = () => {
    const link = document.getElementById('mainFaucetLink') || document.getElementById('faucetModalLink');
    if (!link || !link.dataset.address) return;
    navigator.clipboard.writeText(link.dataset.address).then(() => {
        alert("📋 Dirección copiada al portapapeles");
    });
};

window.copyFaucetKey = () => {
    const key = document.getElementById('faucetKey').textContent;
    if (key === '---') return;
    navigator.clipboard.writeText(key).then(() => {
        alert("📋 Llave Privada copiada al portapapeles");
    });
};

// Global initialization or interval
// Global initialization: start polling when page is visible
let faucetInterval = null;
function startFaucetPolling() {
    if (!faucetInterval) {
        faucetInterval = setInterval(checkFaucetStatus, 15000);
    }
}
function stopFaucetPolling() {
    if (faucetInterval) {
        clearInterval(faucetInterval);
        faucetInterval = null;
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkFaucetStatus();
        startFaucetPolling();
    } else {
        stopFaucetPolling();
    }
});
if (document.visibilityState === 'visible') {
    checkFaucetStatus();
    startFaucetPolling();
}

// --- Elementos DOM ---
const transactionsTableBody = document.getElementById('transactionsTableBody');
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const walletInfo = document.getElementById('walletInfo');
const walletAddress = document.getElementById('walletAddress');
const balanceMatic = document.getElementById('balanceMatic');
const balanceUsdc = document.getElementById('balanceUsdc');
const btnSend = document.getElementById('btnSend');
const txTo = document.getElementById('txTo');
const txAmount = document.getElementById('txAmount');
const txStatus = document.getElementById('txStatus');

// --- Web3 Constants ---
const POLYGON_CHAIN_ID = '0x89'; // 137
const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
// REMOVED HARDCODED CONTRACT_ADDRESS - Uses APP_CONFIG.CONTRACT_ADDRESS instead
const USDC_ABI = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];
const USCD_ABI = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];
let provider, signer, userAddress;
let currentBatchTotalUSDC = 0n; // Use BigInt for precision checking

document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 Wallet App Iniciada");

    initDOMElements();
    attachEventListeners();
    initTheme();

    // Landing Page Trigger - REMOVED SLIDER
    // initVerificationSlider();

    const btnEnterApp = document.getElementById('btnEnterApp');
    if (btnEnterApp) {
        btnEnterApp.disabled = false; // Force enable
        btnEnterApp.addEventListener('click', connectWallet);
    }

    // SESSION RESTORE
    const savedToken = localStorage.getItem('jwt_token');
    const savedAddress = localStorage.getItem('user_address');

    if (savedToken && savedAddress) {
        console.log("🔄 Restoring existing session...");
        AUTH_TOKEN = savedToken;
        userAddress = savedAddress.toLowerCase().trim();

        // Restore Provider
        if (window.ethereum) {
            console.log("📡 Initializing Ethers v6 BrowserProvider (Session Restore)");
            provider = new ethers.BrowserProvider(window.ethereum);
            try {
                // Background network check
                provider.getNetwork().then(network => {
                    console.log("🌐 Network detected (restore):", network.name, network.chainId.toString());
                    if (network.chainId !== 137n) {
                        console.warn("User on wrong network (restore)");
                    }
                });
            } catch (e) {
                console.error("❌ Provider init error during restore", e);
            }
        }

        const landingSection = document.getElementById('landingSection');
        const appLayout = document.getElementById('appLayout');
        const restrictedView = document.getElementById('restrictedView');
        const sidebar = document.querySelector('.sidebar');
        const navAdmin = document.getElementById('navAdmin');

        if (landingSection) landingSection.classList.add('hidden');

        // Parse role from token
        try {
            const payload = JSON.parse(atob(savedToken.split('.')[1]));

            if (payload.role === 'SUPER_ADMIN') {
                if (navAdmin) navAdmin.classList.remove('hidden');
            }

            if (payload.role === 'REGISTERED') {
                if (restrictedView) restrictedView.classList.remove('hidden');
                if (sidebar) sidebar.classList.add('hidden');
                if (appLayout) appLayout.classList.remove('hidden');
                const addrSpan = document.getElementById('restrictedUserAddress');
                if (addrSpan) addrSpan.textContent = userAddress;

                // Even restricted users might need faucet check or logout
                document.getElementById('restrictedLogoutBtn')?.addEventListener('click', logout);
            } else {
                if (appLayout) appLayout.classList.remove('hidden');
                if (restrictedView) restrictedView.classList.add('hidden');
                if (sidebar) sidebar.classList.remove('hidden'); // Show sidebar for valid users

                // Force UI Updates
                updateUI();
                checkFaucetStatus();
                // We do NOT call loadBatches here automatically to avoid double-fetch if updateUI does it, 
                // but usually updateUI handles balance. loadBatches is separate.
                loadBatches();
            }
        } catch (e) {
            // Update UI elements
            const btnConnect = document.getElementById('btnConnect');
            if (btnConnect) btnConnect.innerHTML = "🔌 Conectado";
            const walletInfo = document.getElementById('walletInfo');
            if (walletInfo) walletInfo.classList.remove('hidden');

            // Update Address Link & Text
            const userAddrLink = document.getElementById('userAddressLink');
            if (userAddrLink) {
                userAddrLink.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
                userAddrLink.href = `https://polygonscan.com/address/${userAddress}`;
            }

            // Check Faucet Status to populate sidebar
            checkFaucetStatus();

            // Copy Button Logic
            const btnCopy = document.getElementById('btnCopyAddress');
            if (btnCopy) {
                btnCopy.onclick = () => {
                    navigator.clipboard.writeText(userAddress);
                    const original = btnCopy.innerHTML;
                    btnCopy.innerHTML = "✅";
                    setTimeout(() => btnCopy.innerHTML = original, 2000);
                };
            }

            fetchBalances();
        }
        fetchBatches();
    } else {
        // Just load batches for context
        fetchBatches();
    }

    if (window.ethereum && !savedToken) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
            console.log("🔌 Injected wallet found, ready for login.");
        }
    }
});

function initTheme() {
    const toggleBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const storedTheme = localStorage.getItem('theme') || 'dark';

    // Apply stored
    if (storedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        if (themeIcon) themeIcon.textContent = '☀️';
    } else {
        document.documentElement.removeAttribute('data-theme');
        if (themeIcon) themeIcon.textContent = '🌙';
    }

    if (toggleBtn) {
        toggleBtn.onclick = () => {
            const current = document.documentElement.getAttribute('data-theme');
            if (current === 'light') {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'dark');
                if (themeIcon) themeIcon.textContent = '🌙';
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
                if (themeIcon) themeIcon.textContent = '☀️';
            }
        };
    }
}


/* 
function initVerificationSlider() {
    // ... logic removed ...
}
*/

function initDOMElements() {
    window.batchesListBody = document.getElementById('batchesListBody');
    window.btnConnect = document.getElementById('btnConnect');
    window.btnDisconnect = document.getElementById('btnDisconnect');
    window.walletInfo = document.getElementById('walletInfo');
    window.walletAddress = document.getElementById('walletAddress');
    window.balanceMatic = document.getElementById('maticBalance');
    window.balanceUsdc = document.getElementById('usdcBalance');
    window.userAddressSpan = document.getElementById('userAddress');
    window.batchTableBody = document.getElementById('batchTableBody');

    // Initialize Batch UI Elements (Safe Pattern)
    // initBatchUI(); // Seemingly missing or optional, removing to avoid RefError if it doesn't exist.
    initSummaryModal(); // Inject Modal HTML
    renderBatchFilters(); // Inject Filters

}

function attachEventListeners() {
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', logout);

    const btnDisconnect = document.getElementById('btnDisconnect');
    if (btnDisconnect) btnDisconnect.addEventListener('click', logout);

    const btnRestrictedLogout = document.getElementById('btnRestrictedLogout');
    if (btnRestrictedLogout) btnRestrictedLogout.addEventListener('click', logout);

    // Modal Events
    const btnOpenBatchModal = document.getElementById('btnOpenBatchModal');
    const batchModal = document.getElementById('batchModal');
    const closeBatchModalBtn = document.querySelector('.close-modal');

    if (btnOpenBatchModal && batchModal) {
        btnOpenBatchModal.addEventListener('click', () => {
            batchModal.classList.add('visible'); // Use class for visibility
            batchModal.style.display = 'block'; // Fallback
        });
    }

    if (closeBatchModalBtn && batchModal) {
        closeBatchModalBtn.addEventListener('click', () => {
            batchModal.classList.remove('visible');
            batchModal.style.display = 'none';
        });
    }

    // Close on click outside
    window.onclick = (event) => {
        if (event.target == batchModal) {
            batchModal.classList.remove('visible');
            batchModal.style.display = 'none';
        }
    };

    // Filter toggle
    if (window.btnConnect) window.btnConnect.onclick = connectWallet;

    // Call Batch and Merkle listeners safely
    setupBatchEventListeners();
    setupMerkleTestListener();
}



// ==========================================
// --- INTEGRACIÓN WEB3 (METAMASK) ---
// ==========================================

// Event listeners are now attached in attachEventListeners() called from DOMContentLoaded

function logout() {
    window.logout();
}

window.logout = function () {
    console.log("🔌 Cerrando sesión...");
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_address');
    AUTH_TOKEN = null;
    userAddress = null;
    location.reload(); // Simplest way to reset everything and show landing
}

// Export to window to ensure reachability from HTML attributes
window.connectWallet = connectWallet;

let isConnecting = false;

async function connectWallet() {
    if (isConnecting) {
        console.warn("⚠️ connectWallet ya está en ejecución. Ignorando llamada duplicada.");
        return;
    }

    console.log("🚀 connectWallet called!");
    if (!window.ethereum) {
        console.error("❌ window.ethereum is missing!");
        return alert("⚠️ Instala MetaMask");
    }

    isConnecting = true;

    const btnEnter = document.getElementById('btnEnterApp');
    const originalText = btnEnter ? btnEnter.innerHTML : "";

    try {
        console.log("🔐 Starting SIWE Auth Flow...");
        if (btnEnter) {
            btnEnter.disabled = true;
            btnEnter.innerHTML = "<span>⏳</span> Autenticando...";
        }

        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        console.log("👤 Account found:", accounts[0]);
        userAddress = accounts[0];

        console.log("📡 Initializing BrowserProvider (Ethers v6)");
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        console.log("📍 Signer obtained:", await signer.getAddress());

        // --- SIWE LOGIN FLOW ---
        const nonceRes = await fetch('/api/auth/nonce');
        if (!nonceRes.ok) {
            const errorText = await nonceRes.text();
            throw new Error(`Error al obtener nonce: ${errorText.substring(0, 100)}`);
        }
        const nonce = await nonceRes.text();

        // Anti-HTML check
        if (nonce.includes("<!DOCTYPE") || nonce.includes("<html")) {
            throw new Error("El servidor devolvió un error en lugar de un código de seguridad (Nonce).");
        }

        const domain = window.location.host;
        const origin = window.location.origin;
        const statement = "I accept the DappsFactory Terms and Conditions.";
        const version = "1";
        const chainId = "137"; // Polygon
        const issuedAt = new Date().toISOString();

        // CRITICAL: SIWE requires EIP-55 checksummed address
        const checksummedAddress = ethers.getAddress(userAddress);
        console.log("🆔 Checksummed address for SIWE:", checksummedAddress);

        const message = `${domain} wants you to sign in with your Ethereum account:\n${checksummedAddress}\n\n${statement}\n\nURI: ${origin}\nVersion: ${version}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
        console.log("✍️ Requesting signature...");
        const signature = await signer.signMessage(message);
        console.log("✅ Signature obtained");

        const verifyRes = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, signature })
        });

        const authData = await verifyRes.json();
        if (authData.token) {
            AUTH_TOKEN = authData.token;
            localStorage.setItem('jwt_token', authData.token);
            localStorage.setItem('user_address', authData.address);

            console.log("✅ Authenticated via SIWE");

            // --- TRANSITION TO APP ---
            const landingSection = document.getElementById('landingSection');
            const appLayout = document.getElementById('appLayout');

            if (landingSection) {
                landingSection.style.transition = "opacity 0.5s ease";
                landingSection.style.opacity = "0";
                setTimeout(() => {
                    landingSection.classList.add('hidden');

                    // NEW: Decidir qué vista mostrar según el ROL
                    const payload = JSON.parse(atob(authData.token.split('.')[1]));
                    const role = payload.role;
                    const restrictedView = document.getElementById('restrictedView');
                    const sidebar = document.querySelector('.sidebar');

                    if (role === 'REGISTERED') {
                        if (restrictedView) restrictedView.classList.remove('hidden');
                        if (sidebar) sidebar.classList.add('hidden'); // Hide navigation
                        if (appLayout) appLayout.classList.remove('hidden');
                        const addrSpan = document.getElementById('restrictedUserAddress');
                        if (addrSpan) addrSpan.textContent = authData.address;
                    } else if (appLayout) {
                        appLayout.classList.remove('hidden');
                        if (sidebar) sidebar.classList.remove('hidden');

                        // Show Admin Menu only for SUPER_ADMIN
                        const navAdmin = document.getElementById('navAdmin');
                        const adminRescueFunds = document.getElementById('adminRescueFunds');

                        if (role === 'SUPER_ADMIN') {
                            if (navAdmin) navAdmin.classList.remove('hidden');
                            if (adminRescueFunds) {
                                adminRescueFunds.classList.remove('hidden');
                                adminRescueFunds.onclick = async (e) => {
                                    e.preventDefault();
                                    if (!confirm("⚠️ ¿Estás seguro de iniciar el rescate de fondos?\nEsto barrerá el saldo de TODOS los relayers hacia sus faucets respectivos.")) return;

                                    try {
                                        const res = await authenticatedFetch('/api/admin/rescue', { method: 'POST' });
                                        if (res.ok) {
                                            alert("✅ Proceso iniciado: " + (await res.json()).message);
                                        }
                                    } catch (err) {
                                        alert("❌ Error: " + err.message);
                                    }
                                };
                            }
                        } else {
                            if (navAdmin) navAdmin.classList.add('hidden');
                            if (adminRescueFunds) adminRescueFunds.classList.add('hidden');
                        }

                        appLayout.style.opacity = "0";
                        appLayout.style.transition = "opacity 0.8s ease";
                        setTimeout(() => appLayout.style.opacity = "1", 50);
                    }
                }, 500);
            }

            if (btnConnect) btnConnect.innerHTML = "🔌 Conectado";
            if (walletInfo) walletInfo.classList.remove('hidden');
            if (userAddressSpan) userAddressSpan.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;

            updateUI();
            checkFaucetStatus();
            fetchBatches(); // Keep fetching batches

            window.ethereum.on('accountsChanged', () => location.reload());
            window.ethereum.on('chainChanged', () => location.reload());
        } else {
            throw new Error(authData.error || "Error de verificación SIWE");
        }
    } catch (error) {
        console.error(error);
        if (error.code !== 4001) {
            alert("Error: " + error.message);
        }
        if (btnEnter) {
            btnEnter.disabled = false;
            btnEnter.innerHTML = originalText;
        }
    } finally {
        isConnecting = false;
    }
}

async function checkNetwork() {
    if (!provider) return;
    try {
        const network = await provider.getNetwork();
        console.log("🌐 Current Network ID:", network.chainId.toString());
        if (network.chainId !== 137n) {
            console.log("🔄 Requesting network switch to Polygon...");
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: POLYGON_CHAIN_ID }]
            });
        }
    } catch (e) {
        console.warn("⚠️ Network check/switch error:", e);
    }
}

// Consolidated UI Update
function updateUI() {
    if (!userAddress) return;

    // Update Address Text
    const shortAddr = `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;

    // Sidebar Link
    const sidebarLink = document.getElementById('userAddressLink');
    if (sidebarLink) {
        sidebarLink.textContent = shortAddr;
        sidebarLink.href = getExplorerUrl(userAddress);
    }

    // Top Right Span (if exists)
    if (window.userAddressSpan) window.userAddressSpan.textContent = shortAddr;

    // Restricted View
    const restrictedAddr = document.getElementById('restrictedUserAddress');
    if (restrictedAddr) restrictedAddr.textContent = userAddress;

    // Fetch Balances
    fetchBalances();
}

async function fetchBalances() {
    if (!userAddress || !provider) {
        console.log("🌙 fetchBalances skipped: No userAddress or provider ready yet.");
        return;
    }
    try {
        console.log("💰 Fetching balances for:", userAddress);
        const balance = await provider.getBalance(userAddress);
        const maticVal = parseFloat(ethers.formatEther(balance)).toFixed(4);
        console.log("💎 MATIC Balance:", maticVal);

        const elMatic = document.getElementById('maticBalance');
        if (elMatic) elMatic.textContent = maticVal;

        const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
        const usdcRaw = await usdcContract.balanceOf(userAddress);
        const usdcVal = parseFloat(ethers.formatUnits(usdcRaw, 6)).toFixed(2);
        console.log("💵 USDC Balance:", usdcVal);

        const elUsdc = document.getElementById('usdcBalance');
        if (elUsdc) elUsdc.textContent = usdcVal;

    } catch (e) {
        console.error("❌ Error fetching balances:", e);
    }
}





// ==========================================
// --- GESTIÓN DE LOTES (BATCHES - REFACTOR) ---
// ==========================================

let currentBatchId = null;

// DOM Elements (Initialized in initBatchUI)
let batchListView, batchDetailView, batchesListBody, batchModal, btnOpenBatchModal, btnSaveBatch;
let detailBatchTitle, detailBatchDesc, statTotalUSDC, statTotalTx, statSentTx, statStatus;
let detailUploadContainer, uploadStatus, batchStatsContainer, detailTotalAmount, detailTotalTx;
let merkleContainer, merkleInputZone, merkleResultZone, batchFunderAddress, btnGenerateMerkle;
let displayMerkleRoot, merkleStatus, merkleTotalAmount, merkleFounderBalance, merkleResultBalance, merkleResultFunder;
let batchTableBody;

/**
 * Initializes all Batch UI DOM elements references.
 * Must be called after DOMContentLoaded to ensure elements exist.
 * This prevents ReferenceErrors throughout the application lifecycle.
 */
function initBatchUI() {
    batchListView = document.getElementById('batchListView');
    batchDetailView = document.getElementById('batchDetailView');
    batchesListBody = document.getElementById('batchesListBody');
    batchModal = document.getElementById('batchModal');
    btnOpenBatchModal = document.getElementById('btnOpenBatchModal');
    btnSaveBatch = document.getElementById('btnSaveBatch');

    detailBatchTitle = document.getElementById('detailBatchTitle');
    detailBatchDesc = document.getElementById('detailBatchDesc');
    statTotalUSDC = document.getElementById('statTotalUSDC');
    statTotalTx = document.getElementById('statTotalTx');
    statSentTx = document.getElementById('statSentTx');
    statStatus = document.getElementById('statStatus');
    detailUploadContainer = document.getElementById('detailUploadContainer');
    uploadStatus = document.getElementById('uploadStatus');
    batchStatsContainer = document.getElementById('batchStatsContainer');
    detailTotalAmount = document.getElementById('detailTotalAmount');
    detailTotalTx = document.getElementById('detailTotalTx');

    merkleContainer = document.getElementById('merkleContainer');
    merkleInputZone = document.getElementById('merkleInputZone');
    merkleResultZone = document.getElementById('merkleResultZone');
    batchFunderAddress = document.getElementById('batchFunderAddress');
    btnGenerateMerkle = document.getElementById('btnGenerateMerkle');
    displayMerkleRoot = document.getElementById('displayMerkleRoot');
    merkleStatus = document.getElementById('merkleStatus');

    merkleTotalAmount = document.getElementById('merkleTotalAmount');
    merkleFounderBalance = document.getElementById('merkleFounderBalance');
    merkleResultBalance = document.getElementById('merkleResultBalance');
    merkleResultFunder = document.getElementById('merkleResultFunder');

    batchTableBody = document.getElementById('batchTableBody');
}


// Event Listeners
// Wrappers for Event Listeners (Called after DOM Load)
/**
 * Attaches event listeners to Batch UI elements safely.
 * Wraps logic to prevent crashes if elements are missing (e.g. different user roles).
 */
function setupBatchEventListeners() {
    // These variables must be accessed via DOM or global scope if defined later
    const btnOpenBatchModal = document.getElementById('btnOpenBatchModal');
    const btnSaveBatch = document.getElementById('btnSaveBatch');
    const btnUploadBatch = document.getElementById('btnUploadBatch');
    const btnGenerateMerkle = document.getElementById('btnGenerateMerkle');
    const batchModal = document.getElementById('batchModal');

    if (btnOpenBatchModal && batchModal) btnOpenBatchModal.onclick = () => batchModal.classList.add('active');
    if (btnSaveBatch) btnSaveBatch.onclick = createBatch;
    if (btnUploadBatch) btnUploadBatch.onclick = uploadBatchFile;
    if (btnGenerateMerkle) btnGenerateMerkle.onclick = generateMerkleTree;
}

// Merkle Test Listener
function setupMerkleTestListener() {
    const btnTestMerkle = document.getElementById('btnTestMerkle');
    if (btnTestMerkle) btnTestMerkle.onclick = runMerkleTest;
}


// Global functions for HTML access
window.closeBatchModal = function () {
    const modal = document.getElementById('batchModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('visible');
        modal.style.display = 'none';
    }
};

window.showBatchList = function () {
    console.log("[UI] Returning to batch list...");
    stopTxPolling();
    if (window.balanceInterval) {
        clearInterval(window.balanceInterval);
        window.balanceInterval = null;
    }

    const batchListView = document.getElementById('batchListView');
    const batchDetailView = document.getElementById('batchDetailView');

    if (batchDetailView) batchDetailView.classList.add('hidden');
    if (batchListView) batchListView.classList.remove('hidden');

    // Force Hide Details Sections
    document.getElementById('txDetailSection')?.classList.add('hidden');
    document.getElementById('txTableContainer')?.classList.add('hidden');
    document.getElementById('relayerGridSection')?.classList.add('hidden');

    // Explicitly hide filters logic? No, filters are part of the list view.
    // The previous code had: document.querySelector('.filter-bar')?.classList.add('hidden');
    // But filters SHOULD be visible in list view. Removing that line or verifying intent.
    // Actually, renderBatchFilters injects it into batchListView, so it should be visible along with it.
    // Making sure it is visible if it was hidden:
    document.querySelector('.filter-bar')?.classList.remove('hidden');

    fetchBatches(currentBatchPage || 1); // Refresh list
};

// Pagination State
// let currentBatchPage = 1; // Moved to top

// Pagination State
// const BATCCH_PAGE_SIZE = 10; // Moved to top


// Cargar lista al iniciar o cambiar tab
async function fetchBatches(page = 1) {
    console.log(`[fetchBatches] Fetching page ${page}...`);

    // Safety Force-Get Element
    const tableBody = document.getElementById('batchesListBody');
    if (!tableBody) {
        console.error("CRITICAL: 'batchesListBody' element not found in DOM!");
        return;
    }

    try {
        // Collect Filter Values
        const dateVal = document.getElementById('batchFilterDate')?.value || '';
        const descVal = document.getElementById('batchFilterDesc')?.value || '';
        const statusVal = document.getElementById('batchFilterStatus')?.value || '';
        const amountVal = document.getElementById('batchFilterAmount')?.value || '';

        // Constuct Query
        const params = new URLSearchParams({
            page: page,
            limit: BATCCH_PAGE_SIZE,
            date: dateVal,
            description: descVal,
            status: statusVal,
            amount: amountVal
        });

        const url = `/api/batches?${params.toString()}`;
        console.log(`[fetchBatches] Requesting: ${url}`);

        // Only set loading if empty, to avoid flickering on filters?
        // tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Cargando...</td></tr>';

        const res = await authenticatedFetch(url);
        const data = await res.json();
        console.log(`[fetchBatches] Response:`, data);

        if (data.error) throw new Error(data.error);

        // Handle new response format { batches: [], pagination: {} }
        const batches = data.batches || [];
        const pagination = data.pagination || { currentPage: 1, totalPages: 1 };

        // Pass the element explicitly if needed, but renderBatchesList uses the global. 
        // Let's update renderBatchesList too or rely on window.batchesListBody being updated by initDOMElements?
        // SAFE: Update the global if it's missing (though local 'tableBody' is better context)
        window.batchesListBody = tableBody;

        renderBatchesList(batches);
        updatePaginationUI(pagination);
        currentBatchPage = page;
    } catch (error) {
        console.error("Error fetching batches:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; color: #ef4444; padding: 2rem;">Error al cargar lotes: ${error.message} <br> <button onclick="fetchBatches(1)" class="btn btn-sm btn-primary mt-2">Reintentar</button></td></tr>`;
        }
    }
}

function renderBatchFilters() {
    // Only inject if not exists
    const container = document.querySelector('.card-body'); // Assuming this wraps the table or top section
    // Actually better to inject before the table-responsive div in 'batchListView'
    const batchList = document.getElementById('batchListView');
    if (!batchList || document.querySelector('.filter-bar')) return;

    const filterHTML = `
    <div class="filter-bar">
        <div class="filter-group">
            <label>📅 Fecha</label>
            <input type="date" id="batchFilterDate" onchange="fetchBatches(1)">
        </div>
        <div class="filter-group" style="flex: 2;">
            <label>🔍 Buscar (Desc, Detalle, #)</label>
            <input type="text" id="batchFilterDesc" placeholder="Ej: Lote 345..." onkeyup="debounceFetch()">
        </div>
        <div class="filter-group">
            <label>📊 Estado</label>
            <select id="batchFilterStatus" onchange="fetchBatches(1)">
                <option value="">Todos</option>
                <option value="READY">Preparado 🔵</option>
                <option value="SENT">Enviando 🟢</option>
                <option value="COMPLETED">Completado ✅</option>
                <option value="PREPARING">En Preparación 🟠</option>
            </select>
        </div>
        <div class="filter-group">
            <label>💰 Monto USDC (±10%)</label>
            <input type="number" id="batchFilterAmount" placeholder="Ej: 100" onkeyup="debounceFetch()">
        </div>
        <div class="filter-group" style="justify-content: flex-end;">
            <label>&nbsp;</label>
            <button class="btn-glass btn-sm" onclick="clearFilters()">Limpiar 🧹</button>
        </div>
    </div>
    `;

    // Insert after the existing header/controls if possible
    // Looking at structure, maybe prepend to batchListView or insert before table
    // Let's insert as first child of batchListView
    batchList.insertAdjacentHTML('afterbegin', filterHTML);
}

let debounceTimer;
function debounceFetch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchBatches(1), 500);
}

window.clearFilters = function () {
    const fDate = document.getElementById('batchFilterDate');
    const fDesc = document.getElementById('batchFilterDesc');
    const fStatus = document.getElementById('batchFilterStatus');
    const fAmount = document.getElementById('batchFilterAmount');

    if (fDate) fDate.value = '';
    if (fDesc) fDesc.value = '';
    if (fStatus) fStatus.value = '';
    if (fAmount) fAmount.value = '';

    fetchBatches(1);
};

function updatePaginationUI(pagination) {
    const btnFirst = document.getElementById('firstPage');
    const btnPrev = document.getElementById('prevPage');
    const btnNext = document.getElementById('nextPage');
    const btnLast = document.getElementById('lastPage');
    const indicator = document.getElementById('pageIndicator');

    if (indicator) {
        indicator.textContent = `Página ${pagination.currentPage} de ${pagination.totalPages}`;
    }

    if (btnFirst) {
        btnFirst.disabled = pagination.currentPage <= 1;
        btnFirst.onclick = () => fetchBatches(1);
    }

    if (btnPrev) {
        btnPrev.disabled = pagination.currentPage <= 1;
        btnPrev.onclick = () => fetchBatches(pagination.currentPage - 1);
    }

    if (btnNext) {
        btnNext.disabled = pagination.currentPage >= pagination.totalPages;
        btnNext.onclick = () => fetchBatches(pagination.currentPage + 1);
    }
    if (btnLast) {
        btnLast.disabled = pagination.currentPage >= pagination.totalPages;
        btnLast.onclick = () => fetchBatches(pagination.totalPages);
    }
}

function renderBatchesList(batches) {
    const tableBody = document.getElementById('batchesListBody') || window.batchesListBody;
    if (!tableBody) {
        console.error("CRITICAL: batchesListBody not found in render.");
        return;
    }

    tableBody.innerHTML = '';
    if (batches.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 2rem;">No hay lotes creados. ¡Crea uno nuevo!</td></tr>';
        return;
    }

    batches.forEach(b => {
        const tr = document.createElement('tr');
        const statusBadge = getStatusBadge(b.status);
        const progress = `${b.sent_transactions || 0} / ${b.total_transactions || 0}`;
        // Fix: Divide by 1,000,000 for display
        let totalVal = (b.total_usdc !== null && b.total_usdc !== undefined) ? parseFloat(b.total_usdc) : 0;
        const total = (b.total_usdc !== null) ? `$${(totalVal / 1000000).toFixed(6)}` : '-';
        const date = new Date(b.created_at).toLocaleString('es-AR', TIMEZONE_CONFIG);

        tr.innerHTML = `
            <td style="font-weight: bold;">${b.batch_number}</td>
            <td>${b.detail || '-'}</td>
            <td style="font-size: 0.85rem; opacity: 0.8; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${b.description || ''}">${b.description || '-'}</td>
            <td style="font-size: 0.8rem; opacity: 0.7;">${date}</td>
            <td>${statusBadge}</td>
            <td style="color:#4ade80;">${total}</td>
            <td style="color:#fbbf24; font-weight: bold;">${b.total_gas_used ? parseFloat(b.total_gas_used).toFixed(6) + ' MATIC' : '-'}</td>
            <td>${progress}</td>
            <td>
                <button class="btn-glass" style="padding: 0.3rem 0.8rem; font-size: 0.8rem;" onclick="openBatchDetail(${b.id})">
                    Ver Detalle 👁️ 
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function getStatusBadge(status) {
    if (status === 'READY') return '<span class="badge" style="background: #3b82f6;">Preparado</span>';
    if (status === 'SENT') return '<span class="badge" style="background: #10b981;">Enviando</span>';
    if (status === 'COMPLETED') return '<span class="badge" style="background: #059669; box-shadow: 0 0 10px #059669;">Enviado con Exito</span>';
    if (status === 'PROCESSING') return '<span class="badge" style="background: #8b5cf6;">Procesando</span>';
    return '<span class="badge" style="background: #f59e0b; color: #000;">En Preparación</span>';
}

async function createBatch() {
    const data = {
        batch_number: document.getElementById('newBatchNumber').value,
        detail: document.getElementById('newBatchDetail').value,
        description: document.getElementById('newBatchDesc').value,
    };

    if (!data.batch_number || !data.detail) return alert("Completa Número y Detalle");

    const btnSaveBatch = document.getElementById('btnSaveBatch');

    try {
        if (btnSaveBatch) btnSaveBatch.textContent = "Creando...";

        const res = await authenticatedFetch('/api/batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const responseData = await res.json();

        if (responseData.error) {
            throw new Error(responseData.error);
        }

        // Éxito
        if (window.closeBatchModal) window.closeBatchModal();
        // Limpiar form
        document.getElementById('newBatchNumber').value = '';
        document.getElementById('newBatchDetail').value = '';
        document.getElementById('newBatchDesc').value = '';

        fetchBatches(1); // Recargar lista al inicio

        // Wrap alert in setTimeout to ensure modal closes visually first 
        setTimeout(() => {
            alert("Lote creado exitosamente ✅");
        }, 100);

    } catch (error) {
        console.error(error);
        alert("Error creando lote: " + error.message);
    } finally {
        if (btnSaveBatch) btnSaveBatch.textContent = "Crear Lote";
    }
}

// Global para poder llamarla desde el HTML onclick
window.openBatchDetail = async function (id) {
    console.log(`[UI] openBatchDetail clicked for id: ${id}`);

    // Explicitly fetch elements to avoid scope issues
    const batchListView = document.getElementById('batchListView');
    const batchDetailView = document.getElementById('batchDetailView');

    if (!batchListView || !batchDetailView) {
        console.error("Critical UI Error: Views not found", { batchListView, batchDetailView });
        alert("Error interno: Vistas de interfaz no encontradas. Recarga la página.");
        return;
    }

    if (window.balanceInterval) {
        clearInterval(window.balanceInterval);
        window.balanceInterval = null;
    }
    currentBatchId = id;
    batchListView.classList.add('hidden');
    batchDetailView.classList.remove('hidden');
    window.scrollTo(0, 0); // Scroll to top for better ux

    // Start Polling
    startTxPolling(id);

    // Explicitly Get Elements to avoid RefError
    const detailBatchTitle = document.getElementById('detailBatchTitle');
    const batchTableBody = document.getElementById('batchTableBody');

    // Reset view
    // Reset view (Chaotic State Killer)
    if (detailBatchTitle) detailBatchTitle.textContent = "Cargando...";
    if (batchTableBody) batchTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Cargando...</td></tr>';

    // Force Hide All Sections
    document.getElementById('merkleContainer')?.classList.add('hidden');
    document.getElementById('merkleInputZone')?.classList.add('hidden');
    document.getElementById('merkleResultZone')?.classList.add('hidden');
    document.getElementById('executionZone')?.classList.add('hidden');
    document.getElementById('merkleVerifyZone')?.classList.add('hidden');
    if (document.getElementById('displayMerkleRoot')) document.getElementById('displayMerkleRoot').textContent = "Not Generated";

    // Clear Input Values explicitly
    if (document.getElementById('batchFunderAddress')) document.getElementById('batchFunderAddress').value = "";
    if (document.getElementById('merkleFounderBalance')) document.getElementById('merkleFounderBalance').textContent = "---";

    // Clear Filters UI
    if (document.getElementById('filterWallet')) document.getElementById('filterWallet').value = '';
    if (document.getElementById('filterAmount')) document.getElementById('filterAmount').value = '';
    if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = '';

    // 🛡️ RESET SIGNATURE STATES (Fix for second batch issue)
    // Reset execution button to initial state
    const btnExecute = document.getElementById('btnExecuteBatch');
    if (btnExecute) {
        btnExecute.disabled = false;
        btnExecute.textContent = "2. Ejecutar Lote 🚀";
        btnExecute.classList.remove('btn-success');
        btnExecute.classList.add('btn-primary');
    }

    // Reset setup button
    const btnSetup = document.getElementById('btnSetupRelayers');
    if (btnSetup) {
        btnSetup.disabled = false;
        btnSetup.textContent = "1. Preparar Relayers 🏗️";
        btnSetup.classList.remove('hidden');
    }
    // Hide payment trigger zone
    const paymentTriggerZone = document.getElementById('paymentTriggerZone');
    if (paymentTriggerZone) paymentTriggerZone.classList.add('hidden');

    // Reset UI Components (Gauge)
    if (typeof hideProgressGauge === 'function') hideProgressGauge();

    console.log(`[UI] UI state reset for a new batch completed.`);
    console.log('[UI] 🔄 Batch state reset - Ready for new batch signatures');

    // SHOW DETAILS SECTIONS (Unhide)
    const txDetail = document.getElementById('txDetailSection');
    const txContainer = document.getElementById('txTableContainer');
    const relayerSection = document.getElementById('relayerGridSection');

    if (txDetail) txDetail.classList.remove('hidden');
    if (txContainer) txContainer.classList.remove('hidden');
    if (relayerSection) relayerSection.classList.remove('hidden');

    try {
        const res = await authenticatedFetch(`/api/batches/${id}`);
        const data = await res.json();

        if (data.batch) {
            updateDetailView(data.batch); // Don't pass transactions here, fetch separately

            // Fetch Transactions Server-Side
            await fetchBatchTransactions(id);
            // Refresh relayer balances for this batch
            refreshRelayerBalances();

            // Auto-fill Funder Address if wallet is connected
            const funderInput = document.getElementById('batchFunderAddress');
            if (funderInput && userAddress) {
                funderInput.value = userAddress;
                checkFunderBalance();
            }
        }
    } catch (error) {
        console.error(error);
        alert("Error cargando detalle: " + error.message);
        showBatchList();
    }
};

// Pagination State
// Pagination State
const txPerPage = 10; // Updated to 10 as requested
console.log("[UI] Version 2.4.1-FIX: Filters, UI Bugs & Refund Logic");
// TIMEZONE_CONFIG moved to top

let allBatchTransactions = []; // Store full list
let filteredTransactions = []; // Store filtered list for rendering
let currentTxPage = 1;

// Polling interval
let txPollInterval = null;

// Relayer Pagination State
let currentRelayerPage = 1;
const relayersPerPage = 5;
let allRelayers = [];
window.currentServerTotal = 0; // Server-side pagination total



function updateDetailView(batch) {
    // Explicitly Get Elements to avoid RefError
    const detailBatchTitle = document.getElementById('detailBatchTitle');
    const detailBatchDesc = document.getElementById('detailBatchDesc');
    const batchStatsContainer = document.getElementById('batchStatsContainer');
    const detailTotalTx = document.getElementById('detailTotalTx');
    const detailTotalAmount = document.getElementById('detailTotalAmount');
    const detailUploadContainer = document.getElementById('detailUploadContainer');
    const uploadStatus = document.getElementById('uploadStatus');
    const btnUploadBatch = document.getElementById('btnUploadBatch');
    const merkleContainer = document.getElementById('merkleContainer');
    const merkleStatus = document.getElementById('merkleStatus');
    const merkleTotalAmount = document.getElementById('merkleTotalAmount');
    const merkleInputZone = document.getElementById('merkleInputZone');
    const merkleResultZone = document.getElementById('merkleResultZone');
    const displayMerkleRoot = document.getElementById('displayMerkleRoot');
    const merkleResultFunder = document.getElementById('merkleResultFunder');
    const merkleResultBalance = document.getElementById('merkleResultBalance');

    if (detailBatchTitle) detailBatchTitle.textContent = `${batch.batch_number} - ${batch.detail}`;
    if (detailBatchDesc) detailBatchDesc.textContent = batch.description || "Sin descripción";

    // Stats logic
    if (batchStatsContainer) {
        batchStatsContainer.classList.remove('hidden');
        if (detailTotalTx) detailTotalTx.textContent = batch.total_transactions || 0;

        let totalValString = (batch.total_usdc !== null && batch.total_usdc !== undefined) ? batch.total_usdc.toString() : "0";
        currentBatchTotalUSDC = BigInt(totalValString);

        const totalDisplay = (parseFloat(totalValString) / 1000000).toFixed(6);
        if (detailTotalAmount) detailTotalAmount.textContent = `$${totalDisplay}`;
    }

    // Show/Hide Upload based on status
    if (batch.status === 'PREPARING') {
        if (detailUploadContainer) detailUploadContainer.classList.remove('hidden');
        if (uploadStatus) uploadStatus.textContent = '';
        if (btnUploadBatch) {
            btnUploadBatch.disabled = false;
            btnUploadBatch.textContent = "Subir y Calcular 📤";
        }
        if (merkleContainer) merkleContainer.classList.add('hidden');
    } else {
        if (detailUploadContainer) detailUploadContainer.classList.add('hidden');

        // Merkle Logic (For Ready/Sent batches)
        if (merkleContainer) {
            merkleContainer.classList.remove('hidden');
            if (merkleStatus) merkleStatus.textContent = '';

            // Populate Total in Input Section
            let totalVal = (batch.total_usdc !== null && batch.total_usdc !== undefined) ? parseFloat(batch.total_usdc) : 0;
            const totalDisplay = `$${(totalVal / 1000000).toFixed(6)}`;
            if (merkleTotalAmount) merkleTotalAmount.textContent = totalDisplay;
            const totalRequiredEl = document.getElementById('merkleResultTotalRequired');
            if (totalRequiredEl) totalRequiredEl.textContent = `$${(totalVal / 1000000).toFixed(6)} USDC`;

            // Update Relayer Options Limit
            updateRelayerCountOptions(batch.total_transactions || 100);

            // Populate Funder Info in Merkle Zone
            const funderAddrEl = document.getElementById('displayFunderAddress');
            const funderBalEl = document.getElementById('displayFunderBalance');

            if (funderAddrEl && userAddress) {
                funderAddrEl.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
                // Also update balance if available in global UI
                if (funderBalEl && window.balanceUsdc) {
                    funderBalEl.textContent = window.balanceUsdc.textContent;
                }
            }

            // Update Verification Label
            const verifyLabel = document.getElementById('merkleVerifyLabel');
            if (verifyLabel) {
                const count = Math.min(100, batch.total_transactions || 0);
                verifyLabel.textContent = `🔄 Verificación On-Chain (Muestreo ${count} ${count === 1 ? 'tx' : 'txs'})`;
            }

            // CRITICAL Fix for Merkle Logic
            if (batch.merkle_root && batch.merkle_root !== 'NULL') {
                // Already generated
                if (merkleInputZone) merkleInputZone.classList.add('hidden');
                if (merkleResultZone) merkleResultZone.classList.remove('hidden');
                document.getElementById('merkleVerifyZone')?.classList.remove('hidden');
                document.getElementById('executionZone')?.classList.remove('hidden');
                if (displayMerkleRoot) displayMerkleRoot.textContent = batch.merkle_root;

                if (batch.funder_address) {
                    if (merkleResultFunder) merkleResultFunder.textContent = batch.funder_address;

                    // Fetch Funder Balance for Result View
                    if (merkleResultBalance) {
                        merkleResultBalance.textContent = "Cargando...";
                        fetchUSDCBalance(batch.funder_address).then(bal => {
                            if (merkleResultBalance) merkleResultBalance.textContent = bal;
                        });
                    }
                    // Fetch Allowance
                    updateAllowanceDisplay(batch.funder_address);
                }

                // Progress Bar Handling
                const progressZone = document.getElementById('batchProgressZone');
                // Status is either PROCESSING (currently running) or SENT (started)
                if (batch.status === 'SENT' || batch.status.includes('PROCESSING')) {
                    if (progressZone) progressZone.classList.remove('hidden');
                } else if (batch.status === 'COMPLETED') {
                    if (progressZone) {
                        progressZone.classList.remove('hidden'); // Show 100%
                        const bar = document.getElementById('batchProgressBar');
                        const txt = document.getElementById('batchProgressText');
                        const per = document.getElementById('batchProgressPercent');
                        if (bar) bar.style.width = '100%';
                        if (txt) txt.textContent = "Completado";
                        if (per) per.textContent = "100%";
                    }
                }
            } else {
                // Not Generated yet
                if (merkleInputZone) merkleInputZone.classList.remove('hidden');
                if (merkleResultZone) merkleResultZone.classList.add('hidden');
                document.getElementById('merkleVerifyZone')?.classList.add('hidden');
                document.getElementById('executionZone')?.classList.add('hidden');
            }
        }
    }
}


let batchProgressInterval = null;

function startProgressPolling(batchId) {
    if (batchProgressInterval) return; // Already polling
    console.log(`[UI] Starting progress polling for Batch ${batchId}`);
    batchProgressInterval = setInterval(async () => {
        try {
            const res = await authenticatedFetch(`/api/batches/${batchId}`);
            const data = await res.json();
            if (data.batch) {
                updateProgressBar(data.batch);
                // Also update the table if needed to show hashes/status
                if (data.transactions) {
                    allBatchTransactions = data.transactions;
                    renderBatchTransactions();
                }
                // If status is not active anymore, stop
                if (data.batch.status !== 'SENT' && data.batch.status !== 'PROCESSING') {
                    stopProgressPolling();

                    // Trigger Completion Popup and UI Update
                    if (data.batch.status === 'COMPLETED') {
                        // Update Button State to "Realizado" (Blue)
                        const btnExecute = document.getElementById('btnExecuteBatch');
                        if (btnExecute) {
                            btnExecute.textContent = "Realizado ✅";
                            btnExecute.className = "btn w-full btn-completed"; // Apply new class
                            btnExecute.disabled = true; // Disable click
                        }

                        // Show Summary Modal
                        showBatchSummaryModal(data.batch);

                        // Refresh balances one last time
                        fetchBalances();
                    }
                }
            }
        } catch (err) {
            console.error("Progress Polling Error:", err);
        }
    }, 5000);
}

function stopProgressPolling() {
    if (batchProgressInterval) {
        clearInterval(batchProgressInterval);
        batchProgressInterval = null;
        console.log("[UI] Progress polling stopped.");
    }
}

function updateProgressBar(batch) {
    const total = parseInt(batch.total_transactions) || 0;
    const completed = parseInt(batch.completed_count) || 0;
    const bar = document.getElementById('batchProgressBar');
    const text = document.getElementById('batchProgressText');
    const percent = document.getElementById('batchProgressPercent');

    if (total > 0) {
        const p = Math.floor((completed / total) * 100);
        if (bar) bar.style.width = `${p}%`;
        if (percent) percent.textContent = `${p}%`;
        if (text) text.textContent = `Procesando: ${completed} / ${total}`;
    }
}

async function signBatchPermit(batchId) {
    // 1. Get Batch Total
    const res = await authenticatedFetch(`/api/batches/${batchId}`);
    const data = await res.json();
    if (!res.ok || !data.batch) {
        throw new Error(data.error || "Error al obtener datos del lote (Batch not found)");
    }

    const totalUSDC = BigInt(data.batch.total_usdc || "0");
    const totalTx = parseInt(data.batch.total_transactions || "0");

    if (totalUSDC === 0n) return null;

    // 2. Get Current Allowance & Nonce
    const usdcAbi = [
        "function nonces(address) view returns (uint256)",
        "function allowance(address, address) view returns (uint256)"
    ];
    const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer);

    const nonce = await usdcContract.nonces(userAddress);
    // const allowance = await usdcContract.allowance(userAddress, APP_CONFIG.CONTRACT_ADDRESS);

    // 2.1 Calculate Total Required for ALL Active Batches (Concurrency Support)
    // Fetch all batches to find others that are 'SENT' or 'PROCESSING'
    const allBatchesRes = await authenticatedFetch('/api/batches?limit=100'); // Increase limit to check concurrency better
    const allBatchesData = await allBatchesRes.json();
    const allBatches = allBatchesData.batches || [];

    // Sum total_usdc of active batches (excluding current if duplicates exist, though status check handles it)
    // We want the Permit to cover: This Batch + All Other Active Batches
    let activeSum = BigInt(0);

    if (Array.isArray(allBatches)) {
        allBatches.forEach(b => {
            // If it's active AND not the current one (to avoid double adding if logic overlaps, though current is usually PREPARING)
            // Actually, current batch is 'PREPARING' usually when we sign.
            // Active ones are SENT or PROCESSING.
            if (b.status === 'SENT' || b.status === 'PROCESSING') {
                const bTotal = BigInt(b.total_usdc || "0");
                activeSum += bTotal;
            }
        });
    } else {
        console.warn("[Permit] Could not fetch active batches for concurrency check. Proceeding with single-batch permit.");
    }

    console.log(`[Permit] Current Batch: ${totalUSDC.toString()} | Active Concurrent: ${activeSum.toString()}`);

    // Total Value to Approve = New Batch + Active Batches
    // This ensures we don't accidentally revoke funds for running batches
    // Fix: Use BigInt addition (Ethers v6)
    const value = totalUSDC + activeSum;

    // 2.2 Calculate Dynamic Deadline (Concurrency Support)
    // Formula: (Total Active Txs + Current Batch Txs) * Conservative Time Per Tx
    let activeTxCount = 0;
    allBatches.forEach(b => {
        if (b.status === 'SENT' || b.status === 'PROCESSING') {
            activeTxCount += parseInt(b.total_transactions || 0);
        }
    });

    const combinedTotalTx = activeTxCount + totalTx;

    // User requested configurable duration (Default 2h from server)
    const duration = parseInt(APP_CONFIG.PERMIT_DEADLINE_SECONDS) || 7200;

    console.log(`[Permit] Deadline Fixed: 4 Hours (14400s). Active Txs: ${activeTxCount} + New: ${totalTx}`);
    const deadline = Math.floor(Date.now() / 1000) + duration;

    const chainId = 137; // Hardcoded for Polygon Mainnet USDC compliance
    const domain = { name: 'USD Coin', version: '2', chainId: chainId, verifyingContract: USDC_ADDRESS };
    const types = {
        Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
        ]
    };
    const message = {
        owner: userAddress,
        spender: APP_CONFIG.CONTRACT_ADDRESS,
        value: value.toString(),
        nonce: nonce.toString(),
        deadline: deadline
    };

    const signature = await signer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    return { v, r, s, deadline, amount: value.toString(), signature, owner: userAddress };
}

async function updateAllowanceDisplay(funderAddress) {
    const el = document.getElementById('merkleResultAllowance');
    if (!el || !funderAddress) return;

    try {
        const allowanceStr = await fetchUSDCAllowance(funderAddress);
        el.textContent = allowanceStr;
    } catch (err) {
        el.textContent = "Error";
    }
}

async function fetchUSDCAllowance(address) {
    if (!address || !ethers.isAddress(address)) return "---";
    try {
        let provider;
        if (window.ethereum) {
            provider = new ethers.BrowserProvider(window.ethereum);
        } else {
            provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
        }
        const usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
        const minABI = ["function allowance(address owner, address spender) view returns (uint256)"];
        const contract = new ethers.Contract(usdcAddress, minABI, provider);
        const allowance = await contract.allowance(address, APP_CONFIG.CONTRACT_ADDRESS);
        const formatted = ethers.formatUnits(allowance, 6);
        return `$${parseFloat(formatted).toFixed(6)} USDC`;
    } catch (e) {
        console.error("Fetch Allowance Error", e);
        return "Error";
    }
}

// Filter Logic
window.applyFilters = function () {
    const w = document.getElementById('filterWallet').value.toLowerCase();
    const a = document.getElementById('filterAmount').value;
    const s = document.getElementById('filterStatus').value;

    filteredTransactions = allBatchTransactions.filter(tx => {
        const matchWallet = tx.wallet_address_to.toLowerCase().includes(w);
        // Amount stored as integer (microUSDC), input is human USDC
        let matchAmount = true;
        if (a) {
            const txVal = parseFloat(tx.amount_usdc) / 1000000;
            // Allow slight fuzzy match or exact? Let's starts with exact-ish
            matchAmount = Math.abs(txVal - parseFloat(a)) < 0.000001;
        }
        const matchStatus = s ? tx.status === s : true;

        return matchWallet && matchAmount && matchStatus;
    });

    currentTxPage = 1; // Reset to page 1
    renderBatchTransactions();
};

window.clearFilters = function () {
    document.getElementById('filterWallet').value = '';
    document.getElementById('filterAmount').value = '';
    document.getElementById('filterStatus').value = '';
    filteredTransactions = [...allBatchTransactions];
    currentTxPage = 1;
    renderBatchTransactions();
};

async function generateMerkleTree() {
    console.log("[Merkle] Initiating generation...");
    const btn = document.getElementById('btnGenerateMerkle');
    const status = document.getElementById('merkleStatus');
    if (!currentBatchId) return alert("Selecciona un lote");

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Generando... ⏳";
        }
        if (status) {
            status.textContent = "Construyendo Merkle Tree en el servidor...";
            status.style.color = "#fbbf24";
        }

        const res = await authenticatedFetch(`/api/batches/${currentBatchId}/merkle`, {
            method: 'POST'
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        console.log("[Merkle] Generation Successful:", data.root);

        if (status) {
            status.textContent = "✅ Merkle Tree generado con éxito.";
            status.style.color = "#4ade80";
        }

        // Show Success View
        if (merkleInputZone) merkleInputZone.classList.add('hidden');
        if (merkleResultZone) merkleResultZone.classList.remove('hidden');
        if (document.getElementById('displayMerkleRoot')) document.getElementById('displayMerkleRoot').textContent = data.root;

        // Auto-show execution zone
        document.getElementById('executionZone')?.classList.remove('hidden');

        // Scroll into view
        document.getElementById('merkleContainer')?.scrollIntoView({ behavior: 'smooth' });

        // Update Allowance & Balance for the view
        updateAllowanceDisplay(userAddress);
        fetchUSDCBalance(userAddress).then(bal => {
            if (merkleResultBalance) merkleResultBalance.textContent = bal;
        });

    } catch (e) {
        console.error("Merkle Generation Error", e);
        if (status) {
            status.textContent = "❌ Error: " + e.message;
            status.style.color = "#ef4444";
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Generar Merkle Tree 🛡️";
        }
    }
}

// Server-Side Fetch
async function fetchBatchTransactions(batchId) {
    if (!batchId) return;
    const wallet = document.getElementById('filterWallet')?.value.toLowerCase().trim() || '';
    const amount = document.getElementById('filterAmount')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';

    try {
        const query = new URLSearchParams({
            page: currentTxPage,
            limit: txPerPage,
            wallet,
            amount,
            status
        });

        const res = await authenticatedFetch(`/api/batches/${batchId}/transactions?${query}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        filteredTransactions = data.transactions || [];
        window.currentServerTotal = data.total || 0;
        window.currentTotalPages = data.totalPages || 1;

        renderBatchTransactions();

    } catch (e) {
        console.error("Error searching transactions:", e);
        const tbody = document.getElementById('batchTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:#ef4444; text-align:center;">Error cargando transacciones: ${e.message}</td></tr>`;
    }
}

// Render with Pagination
function renderBatchTransactions() {
    const batchTableBody = document.getElementById('batchTableBody');
    if (!batchTableBody) {
        console.error("CRITICAL: batchTableBody not found in renderBatchTransactions");
        return;
    }

    batchTableBody.innerHTML = '';
    const totalItems = window.currentServerTotal || filteredTransactions.length;

    // Server-side filters return exactly the page we need, no slicing needed
    const pageItems = filteredTransactions;

    if (totalItems === 0) {
        batchTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay registros</td></tr>';
        renderPaginationControls(0);
        return;
    }

    pageItems.forEach(tx => {
        const tr = document.createElement('tr');

        // Wallet Formatting
        const shortWallet = `${tx.wallet_address_to.substring(0, 6)}...${tx.wallet_address_to.substring(38)}`;
        const scanUrl = `https://polygonscan.com/address/${tx.wallet_address_to}`;

        // USDC Formatting (Integer / 1,000,000)
        let usdcVal = parseFloat(tx.amount_usdc);
        const usdcDisplay = (usdcVal / 1000000).toFixed(6);

        // Real Transferred amount
        let realVal = tx.amount_transferred ? parseFloat(tx.amount_transferred) : 0;
        const realDisplay = realVal > 0 ? (realVal / 1000000).toFixed(6) : '-';

        let badgeColor = '#3b82f6'; // Default Blue (PENDING/SENDING_RPC)
        if (tx.status === 'COMPLETED') badgeColor = '#059669'; // Green
        if (tx.status === 'FAILED') badgeColor = '#ef4444'; // Red
        if (tx.status === 'WAITING_CONFIRMATION') badgeColor = '#d97706'; // Amber/Dark Orange
        if (tx.status === 'ENVIANDO') badgeColor = '#8b5cf6'; // Purple

        tr.innerHTML = `
                <td style="opacity: 0.7;">${tx.transaction_reference || '-'}</td>
                <td style="font-family: monospace; display: flex; align-items: center; gap: 0.5rem;">
                    <a href="${scanUrl}" target="_blank" class="hash-link" title="Ver en PolygonScan">
                        ${shortWallet}
                    </a>
                    <button class="btn-icon" onclick="copyToClipboard('${tx.wallet_address_to}')" title="Copiar Dirección">
                        📋
                    </button>
                </td>
                <td style="color: #4ade80; font-weight: bold;">$${usdcDisplay}</td>
                <td style="color: #fbbf24; font-weight: bold;">${realDisplay !== '-' ? '$' + realDisplay : '-'}</td>
                <td style="font-size: 0.85rem; opacity: 0.7;" title="${tx.tx_hash || ''}">
                    ${tx.tx_hash ? `<a href="https://polygonscan.com/tx/${tx.tx_hash}" target="_blank" class="hash-link">${tx.tx_hash.substring(0, 10)}...</a>` : '-'}
                </td>
                <td><span class="badge" style="background: ${badgeColor};">${tx.status}</span></td>
            `;
        batchTableBody.appendChild(tr);
    });

    renderPaginationControls(totalItems);
}

// Helper to copy
window.copyToClipboard = function (text) {
    navigator.clipboard.writeText(text).then(() => {
        // Could show a toast, for now just simple alert or subtle indication
        // alert("Copiado!"); // Too intrusive
    }).catch(err => console.error('Error copying:', err));
};

function renderPaginationControls(totalItems) {
    // Remove existing controls if any
    const existingControls = document.getElementById('paginationControls');
    if (existingControls) existingControls.remove();

    // Update Filter Count UI
    const filterCountEl = document.getElementById('filterResultCount');
    if (filterCountEl) {
        if (totalItems > 0) {
            filterCountEl.textContent = `(Encontrados: ${totalItems})`;
            filterCountEl.style.color = "#a78bfa";
            filterCountEl.style.marginLeft = "10px";
            filterCountEl.style.fontSize = "0.9rem";
        } else {
            filterCountEl.textContent = '';
        }
    }

    if (totalItems <= txPerPage) return; // No pagination needed

    const totalPages = Math.ceil(totalItems / txPerPage);
    // Explicitly expose totalPages to global scope so jump logic works
    window.currentTotalPages = totalPages;

    const div = document.createElement('div');
    div.id = 'paginationControls';
    div.className = 'pagination-controls'; // Add class for easy lookup
    div.style.display = 'flex';
    div.style.justifyContent = 'center';
    div.style.gap = '1rem';
    div.style.marginTop = '1rem';
    div.innerHTML = `
        <button class="btn-glass" onclick="changePage('first')" ${currentTxPage === 1 ? 'disabled' : ''}>⏮️ </button>
        <button class="btn-glass" onclick="changePage(-1)" ${currentTxPage === 1 ? 'disabled' : ''}>⬅️ Ant.</button>
        <span style="align-self: center;">Página ${currentTxPage} de ${totalPages}</span>
        <button class="btn-glass" onclick="changePage(1)" ${currentTxPage === totalPages ? 'disabled' : ''}>Sig. ➡️ </button>
        <button class="btn-glass" onclick="changePage('last')" ${currentTxPage === totalPages ? 'disabled' : ''}>⏭️ </button>
    `;

    // Robust Append: Try known container, else fallback to table parent
    let container = document.querySelector('#batchDetailView .table-container');
    if (!container) {
        // Fallback: Find the table and use its parent
        // Fallback: Find the table and use its parent
        const table = document.getElementById('batchTable');
        if (table) container = table.parentElement;
    }

    if (container) {
        container.appendChild(div);
    } else {
        console.warn("[UI] Pagination container not found");
    }
}


// Polling Functions
function startTxPolling(batchId) {
    if (txPollInterval) clearInterval(txPollInterval);
    console.log("[Polling] Started for Batch " + batchId);
    txPollInterval = setInterval(() => {
        if (!document.hidden && currentBatchId === batchId) {
            fetchBatchTransactions(batchId);
        }
    }, 5000);
}

function stopTxPolling() {
    if (txPollInterval) {
        clearInterval(txPollInterval);
        txPollInterval = null;
        console.log("[Polling] Stopped");
    }
}

window.changePage = function (direction) {
    if (direction === 'first') {
        currentTxPage = 1;
    } else if (direction === 'last') {
        currentTxPage = window.currentTotalPages || 1;
    } else {
        currentTxPage += direction;
    }
    // CRITICAL FIX: Fetch from server for new page
    fetchBatchTransactions(currentBatchId);
};

// Merkle Tree Logic defined below

// --- UPLOAD HANDLER ---
async function uploadBatchFile() {
    console.log("📤 uploadBatchFile called");
    const fileInput = document.getElementById('batchFile');
    const status = document.getElementById('uploadStatus');
    const btnUploadBatch = document.getElementById('btnUploadBatch');

    if (!currentBatchId) return alert("No batch selected");
    if (!fileInput || !fileInput.files[0]) return alert("Selecciona un archivo Excel");

    try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        if (btnUploadBatch) {
            btnUploadBatch.disabled = true;
            btnUploadBatch.textContent = "Subiendo...";
        }
        if (status) status.textContent = "Procesando archivo...";

        const res = await authenticatedFetch(`/api/batches/${currentBatchId}/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        // Upload Success
        if (status) {
            // Fix: Server returns { batch, transactions }, so access properties via data.batch
            const count = data.batch.total_transactions || 0;
            const usdc = data.batch.total_usdc || 0n; // comes as string/bigint
            // Convert usdc to readable string if needed, assuming it's BigInt-like string
            const usdcFloat = parseFloat(usdc.toString()) / 1000000;

            status.textContent = `✅ ¡Éxito! ${count} transacciones cargadas. Monto Total: $${usdcFloat.toFixed(6)}`;
            status.style.color = "#4ade80";
        }

        // FORCE UI UPDATE: Update header stats immediately
        if (data.batch) {
            updateDetailView(data.batch);
        }

        // Auto-trigger Merkle Generation
        console.log("[Upload] Success. Triggering Merkle Generation...");
        await generateMerkleTree();

        // Refresh Batch Data to update UI (transactions list)
        startProgressPolling(currentBatchId);

    } catch (e) {
        console.error(e);
        if (status) {
            status.textContent = "❌ Error: " + e.message;
            status.style.color = "#ef4444";
        }
        alert("Error subiendo archivo: " + e.message);
    } finally {
        if (btnUploadBatch) {
            btnUploadBatch.disabled = false;
            btnUploadBatch.textContent = "Subir y Calcular 📤";
        }
        // Clear input
        if (fileInput) fileInput.value = '';
    }
}

async function generateMerkleTree() {
    if (!currentBatchId) return;

    // Check if wallet is connected
    if (!userAddress || !signer) {
        alert("⚠️ Debes conectar tu Wallet Funder primero.");
        await connectWallet();
        if (!userAddress) return;
    }

    // Use the connected userAddress (already verified by SIWE)
    const funder = (userAddress || localStorage.getItem('user_address'))?.toLowerCase();

    if (!funder || !ethers.isAddress(funder)) {
        return alert("Error: No se detectó una dirección de Funder válida. Por favor, reconéctate.");
    }

    try {
        btnGenerateMerkle.disabled = true;
        btnGenerateMerkle.textContent = "Generando...";
        merkleStatus.textContent = "Calculando árbol criptográfico...";

        const res = await authenticatedFetch(`/api/batches/${currentBatchId}/register-merkle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}) // Funder captured from JWT
        });
        const data = await res.json();

        if (data.root) {
            // Update UI directly to avoid full reload flicker, or just reload logic
            merkleInputZone.classList.add('hidden');
            merkleResultZone.classList.remove('hidden');
            document.getElementById('merkleVerifyZone')?.classList.remove('hidden');
            document.getElementById('executionZone')?.classList.remove('hidden');
            displayMerkleRoot.textContent = data.root;

            // --- FIX FOR "SECOND RUN" VISIBILITY ---
            // Ensure Helper/Setup button is visible and Trigger is hidden (Reset State)
            const btnSetup = document.getElementById('btnSetupRelayers');
            const paymentTriggerZone = document.getElementById('paymentTriggerZone');

            if (btnSetup) {
                btnSetup.classList.remove('hidden');
                btnSetup.disabled = false;
                btnSetup.textContent = "1. Preparar Relayers 🏗️";
            }
            if (paymentTriggerZone) paymentTriggerZone.classList.add('hidden');

            // Refresh Batch Detail
            // fetchBatchDetail(currentBatchId); // This line was not in the original, but was in the provided snippet. Keeping it out as per "no unrelated edits"

            // Update Funder Display immediately so Test works
            if (merkleResultFunder) merkleResultFunder.textContent = funder;

            // Update Balance in Summary
            const balanceEl = document.getElementById('merkleResultBalance');
            if (balanceEl) {
                balanceEl.textContent = "Cargando...";
                fetchUSDCBalance(funder).then(bal => { balanceEl.textContent = bal; });
            }

            merkleStatus.textContent = "✅ Árbol Generado y Guardado.";
        } else {
            throw new Error(data.error || "Error desconocido");
        }

    } catch (error) {
        console.error(error);
        alert("Error: " + error.message);
        merkleStatus.textContent = "❌ Falló la generación.";
    } finally {
        btnGenerateMerkle.disabled = false;
        btnGenerateMerkle.textContent = "Generar Merkle Tree 🛡️";
    }
}



// --- Merkle Verification Test (Client Side) ---
async function runMerkleTest() {
    if (!currentBatchId) return;

    const rootEl = document.getElementById('displayMerkleRoot');
    const merkleRoot = rootEl ? rootEl.textContent.trim() : null;

    if (!merkleRoot || !merkleRoot.startsWith("0x")) {
        alert("⚠️ Genera el Merkle Tree primero");
        return;
    }

    // UI Setup moved up to avoid ReferenceError
    const btn = document.getElementById('btnTestMerkle');
    const status = document.getElementById('merkleTestStatus');
    const verifyLabel = document.getElementById('merkleVerifyLabel');

    // 1. Fetch Sample if needed (Server-Side Fix)
    let testTransactions = typeof allBatchTransactions !== 'undefined' ? allBatchTransactions : [];

    if (!testTransactions || testTransactions.length === 0) {
        // Fetch a small random sample from server
        try {
            if (status) status.textContent = "⏳ Obteniendo muestra del servidor...";
            const res = await authenticatedFetch(`/api/batches/${currentBatchId}/transactions?page=1&limit=100`);
            const data = await res.json();
            if (data.transactions && data.transactions.length > 0) {
                testTransactions = data.transactions;
            } else {
                throw new Error("No se encontraron transacciones en el servidor.");
            }
        } catch (e) {
            alert("⚠️ Error preparando test: " + e.message);
            return;
        }
    }

    // Parameters: Max 100 samples
    const MAX_SAMPLES = 100;
    const MAX_CONCURRENT = 30;

    const sampleSize = Math.min(MAX_SAMPLES, testTransactions.length);
    const shuffled = [...testTransactions].sort(() => 0.5 - Math.random());
    const selectedTxs = shuffled.slice(0, sampleSize);

    if (verifyLabel) {
        verifyLabel.textContent = `🔄 Verificación On-Chain (Muestreo ${sampleSize} ${sampleSize === 1 ? 'tx' : 'txs'})`;
    }
    const funderText = document.getElementById('merkleResultFunder').textContent.trim();

    // Determine Funder Address
    let funder = funderText;
    if (!funder || funder === '---' || !ethers.isAddress(funder)) {
        // Fallback to value input if just generated
        funder = batchFunderAddress.value.trim();
    }

    // Normalize for consistency
    if (funder) funder = funder.toLowerCase();
    if (!ethers.isAddress(funder)) {
        alert("❌ No se encontró address de Funder válida.");
        return;
    }

    if (btn) btn.disabled = true;
    if (status) {
        status.textContent = `⏳ Inicializando test: ${sampleSize} transacciones (${MAX_CONCURRENT} hilos)...`;
        status.style.color = "#fbbf24";
    }

    try {
        // Setup Provider (Read-Only is fine)
        let testProvider;
        if (typeof provider !== 'undefined' && provider) {
            testProvider = provider;
        } else {
            console.log("[Verify] Local provider missing, creating new JsonRpcProvider...");
            if (!APP_CONFIG.RPC_URL) await getConfig();
            testProvider = new ethers.JsonRpcProvider(APP_CONFIG.RPC_URL || "https://polygon-rpc.com");
        }

        if (!testProvider) throw new Error("Could not initialize RPC Provider");

        const abi = ["function validateMerkleProofDetails(uint256, uint256, address, address, uint256, bytes32, bytes32[]) external view returns (bool)"];

        // Use Configured Address
        const targetContract = APP_CONFIG.CONTRACT_ADDRESS;
        if (!targetContract) throw new Error("Contract Address not loaded in Config");

        const contract = new ethers.Contract(targetContract, abi, testProvider);

        let completed = 0;
        let failed = 0;

        // Task Function per Transaction
        const runVerificationTask = async (tx) => {
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    // Fetch Proof from Backend
                    const proofRes = await authenticatedFetch(`/api/batches/${currentBatchId}/transactions/${tx.id}/proof`);
                    if (!proofRes.ok) throw new Error("API Error fetching proof");
                    const proofData = await proofRes.json();

                    if (!proofData.proof) throw new Error("No Proof Data");

                    const amountVal = BigInt(tx.amount_usdc);

                    // Ensure APP_CONFIG is loaded
                    if (!APP_CONFIG.CONTRACT_ADDRESS) await getConfig();

                    // Pre-Validation Check
                    if (!tx.wallet_address_to || !ethers.isAddress(tx.wallet_address_to)) {
                        console.error(`[Verify] Invalid Wallet Address in Tx ${tx.id}:`, tx.wallet_address_to);
                        throw new Error("Invalid Wallet Address");
                    }
                    if (!funder || !ethers.isAddress(funder)) {
                        console.error(`[Verify] Invalid Funder Address:`, funder);
                        throw new Error("Invalid Funder Address");
                    }

                    // Verify On-Chain (View Call)
                    console.log(`[Verify] Testing Tx ${tx.id} | Funder: ${funder} | Recipient: ${tx.wallet_address_to} | Amount: ${amountVal.toString()}`);

                    // Debug: Calculate Leaf locally for comparison (Ethers v5)
                    try {
                        const network = await provider.getNetwork();
                        const encodedLeaf = ethers.AbiCoder.defaultAbiCoder().encode(
                            ["uint256", "address", "uint256", "uint256", "address", "address", "uint256"],
                            [
                                network.chainId,
                                APP_CONFIG.CONTRACT_ADDRESS,
                                BigInt(currentBatchId),
                                BigInt(tx.id),
                                funder,
                                tx.wallet_address_to, // Check this!
                                amountVal
                            ]
                        );
                        const leafHash = ethers.keccak256(encodedLeaf);
                        console.log(`[Verify] CLIENT COMPUTED LEAF: ${leafHash}`);
                    } catch (errLeaf) {
                        console.error("[Verify] Error computing leaf:", errLeaf);
                    }

                    const isValid = await contract.validateMerkleProofDetails(
                        BigInt(currentBatchId),
                        BigInt(tx.id),
                        funder,
                        tx.wallet_address_to,
                        amountVal,
                        merkleRoot,
                        proofData.proof
                    );

                    console.log(`[Verify] Result for Tx ${tx.id}: ${isValid}`);

                    if (!isValid) throw new Error("❌ Invalid On-Chain Result");

                    // Success! Break loop
                    return;

                } catch (err) {
                    attempts++;
                    console.warn(`Verification Attempt ${attempts}/${maxAttempts} failed for Tx ${tx.id}:`, err.message);

                    if (attempts >= maxAttempts) {
                        console.error(`Verification Failed [TxID: ${tx.id}] after retries`, err);
                        failed++;
                    } else {
                        // Exponential backoff: 1s, 2s, 4s
                        const delay = 1000 * Math.pow(2, attempts - 1);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }
            // Finally block handled outside the loop effectively by incrementing counts
            completed++;
            if (status) status.textContent = `⏳ Progreso: ${completed}/${sampleSize} verificados (Fallos: ${failed})`;
        };

        // Execution Queue (Worker Pool Pattern)
        const queue = [...selectedTxs];
        const workers = [];

        const worker = async () => {
            while (queue.length > 0) {
                const tx = queue.shift();
                await runVerificationTask(tx);
                await runVerificationTask(tx);
                await new Promise(r => setTimeout(r, 500)); // Delay added to prevent RPS Limit errors
            }
        };

        // Start Workers
        const workerCount = Math.min(MAX_CONCURRENT, sampleSize);
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }

        // Wait for all
        await Promise.all(workers);

        // Final Report
        if (failed === 0) {
            if (status) {
                status.textContent = `✅ Test Exitoso: ${sampleSize}/${sampleSize} transacciones verificadas en Blockchain.`;
                status.style.color = "#4ade80";
            }
        } else {
            if (status) {
                status.textContent = `❌ Test Fallido: ${failed} errores encontrados. Revisa la consola y tu configuración.`;
                status.style.color = "#ef4444";
            }
        }

    } catch (globalErr) {
        console.error(globalErr);
        if (status) {
            status.textContent = "❌ Error Crítico: " + globalErr.message;
            status.style.color = "#ef4444";
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function checkFunderBalance() {
    const address = batchFunderAddress.value.trim();
    if (!address || !ethers.isAddress(address)) {
        if (merkleFounderBalance) merkleFounderBalance.textContent = "---";
        return;
    }

    if (merkleFounderBalance) merkleFounderBalance.textContent = "Cargando...";

    try {
        const balanceStr = await fetchUSDCBalance(address);
        if (merkleFounderBalance) {
            merkleFounderBalance.textContent = balanceStr;
        }
        // Also update sub-display if visible
        const resultBalance = document.getElementById('merkleResultBalance');
        if (resultBalance) resultBalance.textContent = balanceStr;

        updateAllowanceDisplay(address);
    } catch (error) {
        console.error("Balance Error:", error);
        if (merkleFounderBalance) merkleFounderBalance.textContent = "Error";
    }
}
window.checkFunderBalance = checkFunderBalance;

async function fetchUSDCBalance(address) {
    if (!address || !ethers.isAddress(address)) return "---";
    try {
        let provider;
        if (window.ethereum) {
            provider = new ethers.BrowserProvider(window.ethereum);
        } else {
            provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
        }
        const usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
        const minABI = ["function balanceOf(address owner) view returns (uint256)"];
        const contract = new ethers.Contract(usdcAddress, minABI, provider);
        const usdcBal = await contract.balanceOf(address);
        const usdcFormatted = ethers.formatUnits(usdcBal, 6);
        return `$${parseFloat(usdcFormatted).toFixed(6)} USDC`;
    } catch (e) {
        console.error("Fetch Balance Error", e);
        return "Error";
    }
}
window.fetchUSDCBalance = fetchUSDCBalance;

// Helper to update Relayer Count options based on total transactions
function updateRelayerCountOptions(count) {
    const select = document.getElementById('relayerCount');
    if (!select) return;

    // Clear and rebuild based on count
    select.innerHTML = '';
    const presets = [1, 5, 10, 20, 50];

    presets.forEach(p => {
        if (p <= count || p === 1) { // Always allow 1, others only if <= tx count
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = `${p} ${p === 1 ? '(Safe)' : p === 10 ? '(Fast)' : p >= 50 ? '(Max)' : '(Default)'}`;
            if (p === 5 && count >= 5) opt.selected = true;
            else if (count < 5 && p === 1) opt.selected = true;
            select.appendChild(opt);
        }
    });

    // If count is very small, add a custom option for 'Max' (all txs as relayers)
    // CRITICAL FIX: Absolut max is 100 to prevent Block Gas Limit errors
    const effectiveMax = Math.min(count, 100);

    // Only add custom option if it's not already covered and valid
    if (effectiveMax > 1 && !presets.includes(effectiveMax)) {
        const opt = document.createElement('option');
        opt.value = effectiveMax;
        opt.textContent = `${effectiveMax} (Máximo Absoluto)`;
        select.appendChild(opt);
    }
}

// Relayer Processing Handler
const btnProcessBatch = document.getElementById('btnProcessBatch');
const relayerCountSelect = document.getElementById('relayerCount');
const processStatus = document.getElementById('processStatus');

if (btnProcessBatch) {
    btnProcessBatch.addEventListener('click', async () => {
        if (!currentBatchId) return;
        // Ensure polling is active
        startTxPolling(currentBatchId);
        const count = parseInt(relayerCountSelect.value) || 5;
        if (!confirm(`¿Estás seguro de iniciar la distribución con ${count} Relayer(s)?`)) return;

        if (!signer || !userAddress) {
            alert("⚠️ Debes conectar tu Wallet primero para poder firmar las autorizaciones (Permit y Root).");
            return;
        }

        // --- BALANCE CHECK ---
        try {
            const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
            const userBal = await usdcContract.balanceOf(userAddress); // BigNumber/BigInt

            console.log(`[BalanceCheck] Required: ${currentBatchTotalUSDC}, Found: ${userBal}`);

            if (BigInt(userBal) < currentBatchTotalUSDC) {
                const requiredFmt = ethers.formatUnits(currentBatchTotalUSDC, 6);
                const foundFmt = ethers.formatUnits(userBal, 6);
                alert(`❌ FONDOS INSUFICIENTES en la Wallet Funder.\n\nRequerido: ${requiredFmt} USDC\nDisponible: ${foundFmt} USDC\n\nPor favor recarga tu wallet antes de continuar.`);
                return; // ABORT START
            }
        } catch (balErr) {
            console.error("Balance Check Error:", balErr);
            if (!confirm("⚠️ No se pudo verificar tu saldo de USDC. ¿Deseas continuar bajo tu propio riesgo?")) {
                return;
            }
        }

        // Try to sign Permit if connected
        let permitData = null;
        let rootSignatureData = null;

        if (signer && userAddress) {
            try {
                // 1. Check if Root needs signing (Gasless)
                // Always ask for now, or check contract state if possible. 
                // We ask user because we assume if they are using Permit, they want gasless root set too.
                if (confirm("¿Deseas firmar la RAÍZ DEL MERKLE (Gasless) para autorizar este lote?")) {
                    rootSignatureData = await signBatchRoot(currentBatchId);
                }

                // 2. Check Permit
                if (confirm("¿Deseas firmar un PERMIT automático para evitar 'Approve' manual?")) {
                    permitData = await signBatchPermit(currentBatchId);
                }
            } catch (e) {
                console.warn("Signing process interrupted:", e);
                alert("⚠️ Proceso de firma interrumpido: " + e.message);
                // We allow continuing without signatures (maybe they did manual tx)
            }
        }

        // The original executeBatchDistribution logic is now split into setupRelayerBatch and executeDistribution
        // This listener is effectively replaced by the new button handlers.
        // For now, we'll keep it as a placeholder or remove it if the UI flow changes completely.
        // Given the instruction, the old btnProcessBatch listener should be removed as its logic is now handled by the new functions.
        // The provided code edit effectively replaces the old flow.
    });
}

// --- Distribution Step 1: Prepare ---
async function setupRelayerBatch() {
    if (window.processingBatch) return;
    const count = parseInt(document.getElementById('relayerCount').value) || 5;

    const btnSetup = document.getElementById('btnSetupRelayers');
    const processStatus = document.getElementById('merkleTestStatus');

    try {
        btnSetup.disabled = true;
        btnSetup.textContent = "Preparando... ⏳";
        processStatus.textContent = "🏗️ Creando y fondeando relayers (Transacción Atómica)...";
        processStatus.style.color = "#fbbf24";

        const response = await authenticatedFetch(`/api/batches/${currentBatchId}/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relayerCount: count })
        });
        const res = await response.json();

        if (response.ok) {
            processStatus.textContent = `✅ ${res.count} Relayers listos y fondeados. Ahora puedes disparar.`;
            processStatus.style.color = "#4ade80";

            btnSetup.classList.add('hidden');
            const paymentTriggerZone = document.getElementById('paymentTriggerZone');
            if (paymentTriggerZone) paymentTriggerZone.classList.remove('hidden');

            // Refresh table
            fetchRelayerBalances(currentBatchId);
        } else {
            throw new Error(res.error || "Error en setup");
        }
    } catch (err) {
        console.error(err);
        processStatus.textContent = "❌ Error: " + err.message;
        processStatus.style.color = "#ef4444";
        btnSetup.disabled = false;
        btnSetup.textContent = "1. Preparar Relayers 🏗️";
    }
}

// --- Distribution Step 2: Execute (Sign & Start) ---
async function executeDistribution() {
    if (window.processingBatch) return;

    const btnExecute = document.getElementById('btnExecuteBatch');
    const processStatus = document.getElementById('merkleTestStatus');
    const signHint = document.getElementById('signStatusHint');

    try {
        btnExecute.disabled = true;
        btnExecute.textContent = "Firmando... ✍️ ";
        if (signHint) signHint.textContent = "Por favor, firma en tu wallet...";

        // 1. Sign Permit (Funder -> Contract)
        const permitData = await signBatchPermit(currentBatchId);
        // 2. Sign Root (Funder -> Merkle Proofs)
        const rootSignatureData = await signBatchRoot(currentBatchId);

        processStatus.textContent = "🚀 Enviando firmas y arrancando distribución...";
        processStatus.style.color = "#4ade80";
        if (signHint) signHint.textContent = "Firmas verificadas. Arrancando...";

        const response = await authenticatedFetch(`/api/batches/${currentBatchId}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                permitData,
                rootSignatureData
            })
        });
        const res = await response.json();

        if (response.ok) {
            processStatus.textContent = "✅ Distribución iniciada con éxito.";
            btnExecute.textContent = "✅ En curso";
            if (signHint) signHint.classList.add('hidden');

            // Start Timer
            startTimer();

            // Polling
            if (window.balanceInterval) clearInterval(window.balanceInterval);
            window.balanceInterval = setInterval(() => {
                pollBatchProgress(currentBatchId);
            }, 3000);
        } else {
            throw new Error(res.error || "Error en ejecución");
        }
    } catch (err) {
        console.error(err);
        processStatus.textContent = "❌ Error: " + err.message;
        processStatus.style.color = "#ef4444";
        btnExecute.disabled = false;
        btnExecute.textContent = "Disparar Pagos 🚀";
        if (signHint) signHint.textContent = "Error al firmar. Inténtalo de nuevo.";
    }
}

// Event Listeners Assignments
const btnSetupRelayers = document.getElementById('btnSetupRelayers');
if (btnSetupRelayers) btnSetupRelayers.onclick = setupRelayerBatch;

const btnExecuteBatch = document.getElementById('btnExecuteBatch');
if (btnExecuteBatch) btnExecuteBatch.onclick = executeDistribution;

// --- Signing Helpers ---

async function signBatchPermit(batchId) {
    // 1. Get Batch Total
    const res = await authenticatedFetch(`/api/batches/${batchId}`);
    const data = await res.json();
    if (!res.ok || !data.batch) {
        throw new Error(data.error || "Error al obtener datos del lote (Batch not found)");
    }

    const totalUSDC = BigInt(data.batch.total_usdc || "0");
    const totalTx = parseInt(data.batch.total_transactions || "0");

    if (totalUSDC === 0n) return null;

    // 2. Get Current Allowance & Nonce
    const usdcAbi = [
        "function nonces(address) view returns (uint256)",
        "function allowance(address, address) view returns (uint256)"
    ];
    const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer);

    const nonce = await usdcContract.nonces(userAddress);
    // const allowance = await usdcContract.allowance(userAddress, APP_CONFIG.CONTRACT_ADDRESS);

    // 2.1 Calculate Total Required for ALL Active Batches (Concurrency Support)
    // Fetch all batches to find others that are 'SENT' or 'PROCESSING'
    const allBatchesRes = await authenticatedFetch('/api/batches?limit=100'); // Increase limit to check concurrency better
    const allBatchesData = await allBatchesRes.json();
    const allBatches = allBatchesData.batches || [];

    // Sum total_usdc of active batches (excluding current if duplicates exist, though status check handles it)
    // We want the Permit to cover: This Batch + All Other Active Batches
    let activeSum = BigInt(0);

    if (Array.isArray(allBatches)) {
        allBatches.forEach(b => {
            // If it's active AND not the current one (to avoid double adding if logic overlaps, though current is usually PREPARING)
            // Actually, current batch is 'PREPARING' usually when we sign.
            // Active ones are SENT or PROCESSING.
            if (b.status === 'SENT' || b.status === 'PROCESSING') {
                const bTotal = BigInt(b.total_usdc || "0");
                activeSum += bTotal;
            }
        });
    } else {
        console.warn("[Permit] Could not fetch active batches for concurrency check. Proceeding with single-batch permit.");
    }

    console.log(`[Permit] Current Batch: ${totalUSDC.toString()} | Active Concurrent: ${activeSum.toString()}`);

    // Total Value to Approve = New Batch + Active Batches
    // This ensures we don't accidentally revoke funds for running batches
    // Fix: Use BigInt addition (Ethers v6)
    const value = totalUSDC + activeSum;

    // 2.2 Calculate Dynamic Deadline (Concurrency Support)
    // Formula: (Total Active Txs + Current Batch Txs) * Conservative Time Per Tx
    let activeTxCount = 0;
    allBatches.forEach(b => {
        if (b.status === 'SENT' || b.status === 'PROCESSING') {
            activeTxCount += parseInt(b.total_transactions || 0);
        }
    });

    const combinedTotalTx = activeTxCount + totalTx;

    // User requested configurable duration (Default 2h from server)
    const duration = parseInt(APP_CONFIG.PERMIT_DEADLINE_SECONDS) || 7200;

    console.log(`[Permit] Deadline Fixed: 4 Hours (14400s). Active Txs: ${activeTxCount} + New: ${totalTx}`);
    const deadline = Math.floor(Date.now() / 1000) + duration;

    const chainId = 137; // Hardcoded for Polygon Mainnet USDC compliance
    const domain = { name: 'USD Coin', version: '2', chainId: chainId, verifyingContract: USDC_ADDRESS };
    const types = {
        Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
        ]
    };
    const message = {
        owner: userAddress,
        spender: APP_CONFIG.CONTRACT_ADDRESS,
        value: value.toString(),
        nonce: nonce.toString(),
        deadline: deadline
    };

    const signature = await signer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    return { v, r, s, deadline, amount: value.toString(), signature, owner: userAddress };
}

async function signBatchRoot(batchId) {
    if (!signer || !userAddress) throw new Error("Wallet no conectada");

    const res = await authenticatedFetch(`/api/batches/${batchId}`);
    const data = await res.json();

    if (!res.ok || !data.batch) {
        throw new Error(data.error || "Error al obtener datos del lote (Batch not found)");
    }

    const rootEl = document.getElementById('displayMerkleRoot');
    const merkleRoot = rootEl ? rootEl.textContent.trim() : null;
    if (!merkleRoot || !merkleRoot.startsWith("0x")) throw new Error("Merkle Root inválido");

    const totalTransactions = data.batch.total_transactions || 0;
    const totalAmountBase = data.batch.total_usdc || "0";

    const distributorAbi = ["function nonces(address owner) view returns (uint256)"];
    const contract = new ethers.Contract(APP_CONFIG.CONTRACT_ADDRESS, distributorAbi, provider);
    const nonce = await contract.nonces(userAddress);

    const network = await provider.getNetwork();
    const chainId = 137; // Hardcoded for Polygon Mainnet consistency
    const domain = {
        name: 'BatchDistributor',
        version: '1',
        chainId: chainId,
        verifyingContract: APP_CONFIG.CONTRACT_ADDRESS
    };

    const types = {
        SetBatchRoot: [
            { name: 'funder', type: 'address' },
            { name: 'batchId', type: 'uint256' },
            { name: 'merkleRoot', type: 'bytes32' },
            { name: 'totalTransactions', type: 'uint256' },
            { name: 'totalAmount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' }
        ]
    };

    const message = {
        funder: userAddress,
        batchId: batchId,
        merkleRoot: merkleRoot,
        totalTransactions: totalTransactions,
        totalAmount: totalAmountBase,
        nonce: nonce.toString()
    };

    const signature = await signer.signTypedData(domain, types, message);

    return { merkleRoot, signature, funder: userAddress, totalTransactions, totalAmount: totalAmountBase };
}

// --- Helper Functions (Timer, Faucet, Tables) ---

function startTimer() {
    const timerEl = document.getElementById('processTimer');
    if (!timerEl) return;
    timerEl.style.display = 'block';
    timerEl.style.color = '#f59e0b';
    const startTime = Date.now();
    if (window.processTimerInterval) clearInterval(window.processTimerInterval);
    window.processTimerInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - startTime) / 1000);
        const h = Math.floor(diff / 3600).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        timerEl.textContent = `${h}:${m}:${s}`;
    }, 1000);
}

function stopTimer() {
    if (window.processTimerInterval) {
        clearInterval(window.processTimerInterval);
        window.processTimerInterval = null;
    }
    const timerEl = document.getElementById('processTimer');
    if (timerEl && !timerEl.textContent.includes("Finalizado en")) {
        timerEl.style.color = '#10b981'; // Green
        timerEl.textContent = `⏱️ Finalizado en: ${timerEl.textContent}`;
    }
}

window.openFaucetModal = () => {
    const modal = document.getElementById('faucetModal');
    if (modal) modal.classList.remove('hidden');
    checkFaucetStatus(); // Fetch latest balance immediately
    refreshRelayerBalances();
};

window.closeFaucetModal = () => {
    const modal = document.getElementById('faucetModal');
    if (modal) modal.classList.add('hidden');
};


async function pollBatchProgress(batchId) {
    // 🚨 Safety: Stop if we are viewing a different batch
    if (currentBatchId && parseInt(batchId) !== parseInt(currentBatchId)) {
        console.warn(`[Poll] Ignoring poll for Batch ${batchId} (Current: ${currentBatchId})`);
        return;
    }

    try {
        // Parallel Fetch for Speed ⚡
        const [relayerRes, batchRes] = await Promise.all([
            fetchRelayerBalances(batchId), // Now returns promise but doesn't return data directly to variable (it renders internally)
            fetch(`/api/batches/${batchId}`)
        ]);

        const data = await batchRes.json();
        const batch = data.batch;

        if (batch) {
            // Update Transactions Table
            if (data.transactions) {
                // console.log(`[UI] Refreshing Grid: ${data.transactions.length} txs received.`);
                allBatchTransactions = data.transactions;
                renderBatchTransactions();
            }

            const completed = parseInt(batch.completed_count || 0);
            const total = parseInt(batch.total_transactions || 1);
            const status = batch.status;
            const pending = data.stats ? parseInt(data.stats.pending || 0) : 0;
            const failed = data.stats ? parseInt(data.stats.failed || 0) : 0;

            // Update Progress Bar if exists
            const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
            const progressBar = document.getElementById('batchProgressBar');
            const progressText = document.getElementById('batchProgressText');
            const progressPercent = document.getElementById('batchProgressPercent');
            const batchProgressZone = document.getElementById('batchProgressZone');

            if (batchProgressZone) batchProgressZone.classList.remove('hidden');

            if (progressBar) progressBar.style.width = `${progressPct}%`;
            if (progressText) progressText.textContent = `Procesando: ${completed} / ${total}`;
            if (progressPercent) progressPercent.textContent = `${progressPct}%`;

            // Update Speedometer Gauge (Premium)
            if (typeof updateProgressGauge === 'function') {
                // Ensure the gauge zone is visible if we have transactions
                const gaugeZone = document.getElementById('tradingTerminalZone');
                const legacyZone = document.getElementById('batchProgressGauge');
                if (gaugeZone && total > 0) gaugeZone.classList.remove('hidden');
                if (legacyZone) legacyZone.classList.add('hidden'); // Hide old gauge if exists

                updateProgressGauge(data.stats, total);
            }

            // If we have stats, use strict Pending check
            // FIX: Also check if status is COMPLETED or FAILED (backend stopped processing)
            const isDoneStats = (pending === 0 && total > 0);
            const isBackendDone = (status === 'COMPLETED' || status === 'FAILED');

            // Also check if timer already stopped (processing finished)
            const timerStopped = !window.processTimerInterval;

            if (isDoneStats || isBackendDone || timerStopped || (completed >= total && total > 0)) {
                stopTimer();
                const processStatus = document.getElementById('merkleTestStatus');
                if (processStatus) {
                    if (status === 'FAILED' || failed > 0) {
                        processStatus.textContent = batch.detail || "⚠️ Distribución Finalizada con Errores";
                        processStatus.style.color = "#fbbf24"; // Warning Yellow
                    } else {
                        processStatus.textContent = "✅ ¡Distribución Finalizada!";
                        processStatus.style.color = "#4ade80"; // Success Green
                    }
                }
                const btnExecute = document.getElementById('btnExecuteBatch');
                if (btnExecute) {
                    btnExecute.textContent = "✅ Completado";
                    btnExecute.disabled = true;
                }

                // Slow down polling when finished to save resources
                if (window.balanceInterval) {
                    clearInterval(window.balanceInterval);
                    // Keep polling slowly just in case (e.g. 10s) to see final relayer refunds
                    window.balanceInterval = setInterval(() => pollBatchProgress(batchId), 10000);
                }
            }
        }
    } catch (err) {
        console.error("Error polling batch progress:", err);
    }
}



async function fetchRelayerBalances(batchId) {
    const tbody = document.getElementById('relayerBalancesTableBody');
    console.log(`[RelayerDebug] Fetching balances for batch: ${batchId}`);
    try {
        const response = await authenticatedFetch(`/api/relayers/${batchId}`);
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Fallo en servidor');
        }
        const data = await response.json();
        console.log(`[RelayerDebug] Received ${data.length} relayers`);
        allRelayers = data; // Store full list
        renderRelayerBalances(); // No arg, uses global state
    } catch (err) {
        console.error('Error fetching relayer balances:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1rem; color:#ef4444;">⚠️ Error: ${err.message}</td></tr>`;
        }
    }
}

async function signBatchRoot(batchId) {
    if (!signer || !userAddress) throw new Error("Wallet no conectada");

    const res = await authenticatedFetch(`/api/batches/${batchId}`);
    const data = await res.json();

    if (!res.ok || !data.batch) {
        throw new Error(data.error || "Error al obtener datos del lote (Batch not found)");
    }

    const rootEl = document.getElementById('displayMerkleRoot');
    const merkleRoot = rootEl ? rootEl.textContent.trim() : null;
    if (!merkleRoot || !merkleRoot.startsWith("0x")) throw new Error("Merkle Root inválido");

    const totalTransactions = data.batch.total_transactions || 0;
    const totalAmountBase = data.batch.total_usdc || "0";

    const distributorAbi = ["function nonces(address owner) view returns (uint256)"];
    const contract = new ethers.Contract(APP_CONFIG.CONTRACT_ADDRESS, distributorAbi, provider);
    const nonce = await contract.nonces(userAddress);

    const network = await provider.getNetwork();
    const chainId = 137; // Hardcoded for Polygon Mainnet consistency
    const domain = {
        name: 'BatchDistributor',
        version: '1',
        chainId: chainId,
        verifyingContract: APP_CONFIG.CONTRACT_ADDRESS
    };

    const types = {
        SetBatchRoot: [
            { name: 'funder', type: 'address' },
            { name: 'batchId', type: 'uint256' },
            { name: 'merkleRoot', type: 'bytes32' },
            { name: 'totalTransactions', type: 'uint256' },
            { name: 'totalAmount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' }
        ]
    };

    const message = {
        funder: userAddress,
        batchId: batchId,
        merkleRoot: merkleRoot,
        totalTransactions: totalTransactions,
        totalAmount: totalAmountBase,
        nonce: nonce.toString()
    };

    const signature = await signer.signTypedData(domain, types, message);

    return { merkleRoot, signature, funder: userAddress, totalTransactions, totalAmount: totalAmountBase };
}

// Update signature to use global state if data not provided (or handle both)
function renderRelayerBalances(explicitData) {
    // If explicitData is passed (legacy call), use it but warn/adapt? 
    // Actually, improved flow uses allRelayers global.
    const data = explicitData || allRelayers;

    const tbody = document.getElementById('relayerBalancesTableBody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1rem;">No hay relayers activos para este lote</td></tr>';
        // Remove pagination if empty
        const ctrls = document.getElementById('relayerPaginationControls');
        if (ctrls) ctrls.remove();
        return;
    }

    // Pagination Logic
    const start = (currentRelayerPage - 1) * relayersPerPage;
    const end = start + relayersPerPage;
    const pageItems = data.slice(start, end);

    // --- Header Info: Funding Tx (Shared) ---
    // Assuming all relayers share the same funding tx, we take the first one.
    const fundingTx = data[0]?.transactionhash_deposit;
    const fundingTxLink = fundingTx ? `<a href="https://polygonscan.com/tx/${fundingTx}" target="_blank" class="hash-link" style="color: #60a5fa; font-family: monospace;">${fundingTx} ➔ </a>` : '<span style="color:#94a3b8">Pendiente...</span>';

    const infoDiv = document.getElementById('relayerGridInfo');
    if (infoDiv) {
        infoDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem; background: rgba(255,255,255,0.03); padding: 0.5rem 1rem; border-radius: 6px;">
                <span style="font-size: 0.85rem; color: #cbd5e1;">⚡ TX Carga Relayers:</span>
                ${fundingTxLink}
            </div>
        `;
    }

    tbody.innerHTML = pageItems.map(r => {
        const shortAddr = `${r.address.substring(0, 6)}...${r.address.substring(38)}`;
        const isStale = r.isStale === true;
        const isDrained = r.status === 'drained';

        let balanceVal = parseFloat(r.balance || 0);
        let balanceDisplayStr = `${balanceVal.toFixed(6)} MATIC`;
        let balanceColor = '#4ade80';

        if (isDrained) {
            balanceVal = 0;
            balanceDisplayStr = `0.000000 MATIC`; // Force zero display
            balanceColor = '#94a3b8'; // Greyout
        } else if (isStale) {
            balanceDisplayStr = `${balanceVal.toFixed(6)} MATIC <span style="font-size: 0.7rem; color: #fbbf24;">(Persistente 💾)</span>`;
            balanceColor = '#fbbf24';
        }

        const balanceDisplay = balanceDisplayStr;
        const txCount = r.tx_count || 0;

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:0.75rem; color:#94a3b8; font-size:0.8rem; font-weight:bold;">#${r.id}</td>
                <td style="padding:0.75rem; font-family:monospace; font-size:0.85rem;">
                    <a href="${getExplorerUrl(r.address)}" target="_blank" class="hash-link">${shortAddr} ➔ </a>
                </td>
                <td style="padding:0.75rem; color:${balanceColor}; font-weight:bold;">${balanceDisplay}</td>
                <td style="padding:0.75rem; color:#94a3b8; font-size:0.8rem;">
                    ${r.lastActivity ? new Date(r.lastActivity).toLocaleTimeString() : 'Sin actividad'}
                </td>
                <td style="padding:0.75rem; text-align:center; font-weight:bold; color: #fff;">
                    ${txCount}
                </td>
            </tr>
        `;
    }).join('');

    // Check for Refund Success (Drained Status)
    const isDrained = data.some(r => r.status === 'drained');
    if (isDrained) {
        // Stop the timer when funds are recovered
        stopTimer();

        tbody.innerHTML += `
            <tr>
                <td colspan="5" style="text-align: center; padding: 1rem; color: #4ade80; background: rgba(16, 185, 129, 0.1); border-radius: 8px; margin-top: 5px;">
                    ✅ <b>Recovered remaining relayer funds to the Faucet wallet.</b>
                </td>
            </tr>
        `;
    }

    renderRelayerPaginationControls(data.length);

    const btnSetup = document.getElementById('btnSetupRelayers');
    const paymentTriggerZone = document.getElementById('paymentTriggerZone');

    if (data.length > 0) {
        document.getElementById('executionZone')?.classList.remove('hidden');
        if (btnSetup) btnSetup.classList.add('hidden');
        if (paymentTriggerZone) paymentTriggerZone.classList.remove('hidden');
    } else {
        // Reset state for new batch or if relayers were cleared
        // document.getElementById('executionZone')?.classList.add('hidden'); // REMOVED: Managed by Merkle Logic
        if (btnSetup) btnSetup.classList.remove('hidden');
        if (paymentTriggerZone) paymentTriggerZone.classList.add('hidden');
    }
}

// Relayer Pagination Helper
function renderRelayerPaginationControls(totalItems) {
    const existing = document.getElementById('relayerPaginationControls');
    if (existing) existing.remove();

    if (totalItems <= relayersPerPage) return;

    const totalPages = Math.ceil(totalItems / relayersPerPage);
    const div = document.createElement('div');
    div.id = 'relayerPaginationControls';
    div.style.display = 'flex';
    div.style.justifyContent = 'center';
    div.style.gap = '1rem';
    div.style.marginTop = '1rem';
    div.style.paddingPadding = '1rem';

    div.innerHTML = `
        <button class="btn-glass" onclick="changeRelayerPage(-1)" ${currentRelayerPage === 1 ? 'disabled' : ''}>⬅️ Anterior</button>
        <span style="align-self: center; font-size: 0.9rem;">Página ${currentRelayerPage} de ${totalPages}</span>
        <button class="btn-glass" onclick="changeRelayerPage(1)" ${currentRelayerPage === totalPages ? 'disabled' : ''}>Siguiente ➡️ </button>
    `;

    // Append to Relayer Table Container
    const table = document.getElementById('relayerBalancesTable');
    if (table && table.parentElement) {
        table.parentElement.appendChild(div);
    }
}

window.changeRelayerPage = function (direction) {
    currentRelayerPage += direction;
    renderRelayerBalances();
};

window.triggerGasDistribution = async () => {
    if (!currentBatchId) return alert("Seleccione un lote primero");

    // Get count from whichever input is available (Modal or Main)
    const modalInput = document.getElementById('relayerCountInput');
    const mainSelect = document.getElementById('relayerCount');
    const count = parseInt(modalInput?.value || mainSelect?.value) || 5;

    const modalStatus = document.getElementById('modalFaucetStatus');
    if (modalStatus) {
        modalStatus.textContent = "⏳ Iniciando distribución...";
        modalStatus.style.color = "#fbbf24";
    }

    // This function was previously calling executeBatchDistribution(count, permitData, rootSignatureData);
    // Now it should call setupRelayerBatch as per the new flow.
    // The provided code edit changes this to call setupRelayerBatch directly.
    await setupRelayerBatch();
};

window.refreshRelayerBalances = () => {
    if (currentBatchId) {
        fetchRelayerBalances(currentBatchId);
    } else {
        const tbody = document.getElementById('relayerBalancesTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:1rem;">Seleccione un lote para ver relayers</td></tr>';
    }
};

// Auto-refresh every 60s (1 minute) normally
// Auto-refresh every 60s (1 minute) for Faucet
setInterval(() => {
    checkFaucetStatus();
}, 60000);

// Auto-refresh Relayer Balances every 15s (User Request)
setInterval(() => {
    // Only poll here if we are NOT in "active processing" mode (window.balanceInterval)
    // to avoid double-polling.
    if (currentBatchId && !window.balanceInterval) {
        console.log("[Auto-Refresh] Updating Relayer Grid (5s)...");
        refreshRelayerBalances();
    }
}, 5000);

// Initial calls
checkFaucetStatus();




// --- ECharts Trading Terminal Logic ---
let gaugeChart = null;
let activityChart = null;
let distChart = null;
let activityData = [];

function initECharts() {
    const gContainer = document.getElementById('echartsGauge');
    const aContainer = document.getElementById('echartsActivity');
    const dContainer = document.getElementById('echartsStatusDist');
    if (!gContainer || !aContainer || !dContainer) return;

    gaugeChart = echarts.init(gContainer, 'dark', { renderer: 'svg' });
    activityChart = echarts.init(aContainer, 'dark', { renderer: 'svg' });
    distChart = echarts.init(dContainer, 'dark', { renderer: 'svg' });

    window.addEventListener('resize', () => {
        gaugeChart.resize();
        activityChart.resize();
        distChart.resize();
    });
}

function updateProgressGauge(stats, total) {
    if (!stats) return;

    const zone = document.getElementById('tradingTerminalZone');
    if (zone) zone.classList.remove('hidden');

    if (!gaugeChart) initECharts();

    const completed = parseInt(stats.completed || 0);
    const pending = parseInt(stats.pending || 0);
    const failed = parseInt(stats.failed || 0);
    const sending = parseInt(stats.sending || 0);
    const queued = parseInt(stats.queued || 0);

    const successPct = total > 0 ? (completed / total) * 100 : 0;
    const processPct = total > 0 ? ((completed + sending + queued) / total) * 100 : 0;
    const failedPct = total > 0 ? (failed / total) * 100 : 0;

    // 1. Update Gauge (ECharts Progress Gauge Style)
    const gaugeOption = {
        backgroundColor: 'transparent',
        series: [{
            type: 'gauge',
            startAngle: 90,
            endAngle: -270,
            pointer: { show: false },
            progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { borderWidth: 1, borderColor: '#464646' } },
            axisLine: { lineStyle: { width: 40 } },
            splitLine: { show: false },
            axisTick: { show: false },
            axisLabel: { show: false },
            data: [
                { value: successPct.toFixed(2), name: 'Success', itemStyle: { color: '#00ff88' } },
                { value: processPct.toFixed(2), name: 'In Progress', itemStyle: { color: '#f0b90b' }, z: 1 },
                { value: 100, name: 'Total Scope', itemStyle: { color: 'rgba(255, 51, 102, 0.2)' }, z: 0 }
            ],
            detail: { fontSize: 30, color: '#fff', formatter: '{value}%', fontWeight: 'bold', offsetCenter: [0, '0%'] }
        }]
    };
    gaugeChart.setOption(gaugeOption);

    // 2. Update Status Distribution (Doughnut with Rounded Corners)
    const distOption = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item' },
        legend: { bottom: '0%', left: 'center', textStyle: { color: '#64748b', fontSize: 10 } },
        series: [{
            name: 'Status Distribution',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: { borderRadius: 10, borderColor: '#080c18', borderWidth: 2 },
            label: { show: false, position: 'center' },
            emphasis: { label: { show: true, fontSize: 20, fontWeight: 'bold', color: '#fff' } },
            data: [
                { value: completed, name: 'Completed', itemStyle: { color: '#00ff88' } },
                { value: sending, name: 'Sending', itemStyle: { color: '#3b82f6' } },
                { value: queued, name: 'Queued', itemStyle: { color: '#f0b90b' } },
                { value: pending, name: 'Pending', itemStyle: { color: '#64748b' } },
                { value: failed, name: 'Failed', itemStyle: { color: '#ff3366' } }
            ]
        }]
    };
    distChart.setOption(distOption);

    // 3. Update Activity Sparkline
    activityData.push(completed);
    if (activityData.length > 50) activityData.shift();

    activityChart.setOption({
        backgroundColor: 'transparent',
        grid: { top: 10, bottom: 5, left: 0, right: 0 },
        xAxis: { type: 'category', boundaryGap: false, show: false },
        yAxis: { type: 'value', show: false },
        series: [{
            data: activityData,
            type: 'line',
            smooth: true,
            symbol: 'none',
            lineStyle: { color: '#00ff88', width: 2 },
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0, 255, 136, 0.2)' }, { offset: 1, color: 'rgba(0, 255, 136, 0)' }]) }
        }]
    });

    // 4. Update Text Counters
    document.getElementById('terminalStatus').textContent = (sending > 0 || queued > 0) ? 'EXECUTING' : (completed === total ? 'FINISHED' : 'WAITING');
    document.getElementById('terminalSuccessRate').textContent = successPct.toFixed(2) + '%';
    document.getElementById('terminalProcessed').textContent = completed + ' / ' + total;
}

function hideProgressGauge() {
    const zone = document.getElementById('tradingTerminalZone');
    if (zone) zone.classList.add('hidden');
}

window.updateProgressGauge = updateProgressGauge;
window.hideProgressGauge = hideProgressGauge;

// ==========================================
// --- BATCH SUMMARY POPUP ---
// ==========================================

function initSummaryModal() {
    if (document.getElementById('batchSummaryModal')) return;

    const modalHTML = `
    <div id="batchSummaryModal" class="summary-modal">
        <div class="summary-content">
            <div class="summary-header">
                <div class="summary-title">🎉 Lote Completado</div>
                <div class="summary-subtitle">Resumen de Ejecución y Métricas</div>
            </div>

            <div class="summary-grid">
                <!-- Card 1: Sent -->
                <div class="summary-card">
                    <div class="summary-label">Total Enviado</div>
                    <div class="summary-value success" id="sumTotalSent">---</div>
                </div>
                 <!-- Card 2: Cost -->
                <div class="summary-card">
                    <div class="summary-label">Costo Total Gas</div>
                    <div class="summary-value highlight" id="sumTotalGas">---</div>
                    <div class="unit-label" id="sumGasAvg" style="margin-top:5px; font-size:0.7rem;">Promedio: ---</div>
                </div>
            </div>

            <div class="summary-card" style="margin-bottom: 2rem; text-align:left;">
                <div class="summary-label" style="text-align:center; margin-bottom:1rem;"> IMPACTO FINANCIERO </div>
                
                <div class="balance-row">
                    <span style="color:var(--text-muted)">Funder Wallet (Inicio)</span>
                    <span id="sumFunderStart">---</span>
                </div>
                <div class="balance-row">
                    <span style="color:var(--text-muted)">Funder Wallet (Final)</span>
                    <span id="sumFunderEnd" style="color:var(--text-primary); font-weight:bold;">---</span>
                </div>
                <div style="height:1px; background:rgba(255,255,255,0.1); margin: 0.5rem 0;"></div>
                 <div class="balance-row">
                    <span style="color:var(--text-muted)">Faucet (Inicio)</span>
                    <span id="sumFaucetStart">---</span>
                </div>
                 <div class="balance-row">
                    <span style="color:var(--text-muted)">Faucet (Final)</span>
                    <span id="sumFaucetEnd" style="color:var(--text-primary); font-weight:bold;">---</span>
                </div>
            </div>
            
            <div style="text-align:center; margin-bottom: 2rem; color: var(--text-muted); font-size: 0.8rem;">
                ⏱️ Tiempo de Ejecución: <span id="sumDuration" style="color:var(--accent);">---</span>
            </div>

            <div class="summary-footer">
                <button class="btn-close-summary" onclick="closeSummaryModal()">
                    ¡Excelente! 🚀
                </button>
            </div>
        </div>
    </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.showBatchSummaryModal = function (batch) {
    const modal = document.getElementById('batchSummaryModal');
    if (!modal) return;

    // Parse Metrics
    let metrics = {};
    if (batch.metrics && typeof batch.metrics === 'object') {
        metrics = batch.metrics;
    } else if (batch.metrics) {
        try { metrics = JSON.parse(batch.metrics); } catch (e) { }
    }

    // Populate Data
    // 1. Total Sent
    const totalUSDC = (parseFloat(batch.total_usdc || 0) / 1000000).toFixed(2);
    document.getElementById('sumTotalSent').textContent = `$${totalUSDC} USDC`;

    // 2. Gas
    const totalGas = parseFloat(batch.total_gas_used || 0).toFixed(6);
    document.getElementById('sumTotalGas').textContent = `${totalGas} MATIC`;

    // Avg Gas
    const txCount = parseInt(batch.total_transactions || 1);
    const avgGas = (parseFloat(batch.total_gas_used || 0) / txCount).toFixed(6);
    document.getElementById('sumGasAvg').textContent = `Avg: ${avgGas} MATIC/tx`;

    // 3. Duration
    document.getElementById('sumDuration').textContent = batch.execution_time || "---";

    // 4. Balances
    const initial = metrics.initial || {};
    const final = metrics.final || {};

    const fmt = (val) => val ? parseFloat(val).toFixed(4) + ' MATIC' : '---';

    document.getElementById('sumFunderStart').textContent = fmt(initial.funderBalance);
    document.getElementById('sumFunderEnd').textContent = fmt(final.funderBalance);

    document.getElementById('sumFaucetStart').textContent = fmt(initial.faucetBalance);
    document.getElementById('sumFaucetEnd').textContent = fmt(final.faucetBalance);

    // Show
    modal.classList.add('active');
};

window.closeSummaryModal = function () {
    const modal = document.getElementById('batchSummaryModal');
    if (modal) modal.classList.remove('active');
};
