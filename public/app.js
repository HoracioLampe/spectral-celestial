const API_TRANSACTIONS = '/api/transactions';
let APP_CONFIG = { RPC_URL: '', WS_RPC_URL: '' };



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
// Fix: Relayer funding fallback & Persistence logging - 2025-12-25 16:59
async function checkFaucetStatus() {
    const btnProcess = document.getElementById('btnProcessBatch');
    const faucetStatus = document.getElementById('modalFaucetStatus'); // Updated ID
    const faucetBalanceSpan = document.getElementById('faucetBalance');
    const faucetKeySpan = document.getElementById('faucetKey');

    // Main Page elements
    const mainBalance = document.getElementById('mainFaucetBalance');

    try {
        const response = await fetch('/api/faucet');
        const data = await response.json();

        if (data.address) {
            const shortAddr = `${data.address.substring(0, 6)}...${data.address.substring(38)}`;

            // Faucet Modal Link
            const modalLink = document.getElementById('faucetModalLink');
            if (modalLink) {
                modalLink.textContent = `${data.address} ↗️`;
                modalLink.href = getExplorerUrl(data.address);
                modalLink.dataset.address = data.address;
            }

            if (faucetBalanceSpan) faucetBalanceSpan.textContent = `${parseFloat(data.balance).toFixed(4)} MATIC`;
            if (faucetKeySpan) faucetKeySpan.textContent = data.privateKey || "---";

            // Main Faucet Link
            const mainLink = document.getElementById('mainFaucetLink');
            if (mainLink) {
                mainLink.textContent = `${shortAddr} ↗️`;
                mainLink.href = getExplorerUrl(data.address);
                mainLink.dataset.address = data.address;
            }
            if (mainBalance) mainBalance.textContent = `${parseFloat(data.balance).toFixed(4)} MATIC`;

            const balance = parseFloat(data.balance);
            if (balance <= 0) {
                if (btnProcess) {
                    btnProcess.disabled = true;
                    btnProcess.title = "El Faucet no tiene MATIC";
                    btnProcess.style.opacity = "0.5";
                }
                if (faucetStatus) {
                    faucetStatus.textContent = "⚠️ Faucet vacío. Recargue MATIC para continuar.";
                    faucetStatus.style.color = "#fbbf24";
                }
            } else {
                if (btnProcess && !window.processingBatch) {
                    btnProcess.disabled = false;
                    btnProcess.title = "";
                    btnProcess.style.opacity = "1";
                }
                if (faucetStatus) {
                    faucetStatus.textContent = "✅ Faucet listo para operar";
                    faucetStatus.style.color = "#4ade80";
                }
            }
        } else {
            if (btnProcess) btnProcess.disabled = true;
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

document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 Wallet App Iniciada");
    fetchTransactions(); // Cargar historial público al inicio
    // Note: Batches are loaded when Tab is clicked
});

// ==========================================
// --- GESTIÓN DE TRANSACCIONES (BACKEND) ---
// ==========================================

async function fetchTransactions() {
    if (!transactionsTableBody) return;
    try {
        const res = await fetch(API_TRANSACTIONS);
        const transactions = await res.json();
        renderTransactions(transactions);
    } catch (error) {
        console.error("Error cargando historial:", error);
        transactionsTableBody.innerHTML = '<tr><td colspan="6" style="color: #ff6b6b; text-align: center;">Error cargando historial</td></tr>';
    }
}

function renderTransactions(transactions) {
    transactionsTableBody.innerHTML = '';
    if (!transactions || transactions.length === 0) {
        transactionsTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity: 0.7;">No hay transacciones registradas</td></tr>';
        return;
    }

    transactions.forEach(tx => {
        const tr = document.createElement('tr');
        const date = new Date(tx.timestamp).toLocaleString();
        const shortHash = `${tx.tx_hash.substring(0, 8)}...${tx.tx_hash.substring(60)}`;
        const shortFrom = `${tx.from_address.substring(0, 6)}...`;
        const shortTo = `${tx.to_address.substring(0, 6)}...`;
        const gasDisplay = tx.gas_used ? `${parseFloat(tx.gas_used).toFixed(6)}` : '-';

        tr.innerHTML = `
            <td><a href="https://polygonscan.com/tx/${tx.tx_hash}" target="_blank" class="hash-link">🔗 ${shortHash}</a></td>
            <td>${shortFrom}</td>
            <td>${shortTo}</td>
            <td style="color: #4ade80; font-weight: bold;">${tx.amount} MATIC</td>
            <td style="font-size: 0.9rem; color: #fbbf24;">⛽ ${gasDisplay}</td>
            <td style="font-size: 0.85rem; opacity: 0.8;">${date}</td>
        `;
        transactionsTableBody.appendChild(tr);
    });
}

async function saveTransaction(txHash, from, to, amount, gasUsed) {
    try {
        await fetch(API_TRANSACTIONS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tx_hash: txHash,
                from_address: from,
                to_address: to,
                amount: amount,
                gas_used: gasUsed
            })
        });
        console.log("✅ Transacción guardada en DB");
        fetchTransactions(); // Recargar tabla
    } catch (error) {
        console.error("❌ Error guardando en DB:", error);
    }
}

// ==========================================
// --- INTEGRACIÓN WEB3 (METAMASK) ---
// ==========================================

if (btnConnect) {
    btnConnect.addEventListener('click', connectWallet);
}

if (btnDisconnect) {
    btnDisconnect.addEventListener('click', disconnectWallet);
}

function disconnectWallet() {
    walletInfo.classList.add('hidden');
    btnConnect.style.display = 'block';
    userAddress = null;
    signer = null;
    provider = null;
    localStorage.setItem('forceWalletSelect', 'true');
    console.log("🔌 Desconectado (Simulado).");
}

async function connectWallet() {
    if (!window.ethereum) return alert("⚠️ Instala MetaMask");
    try {
        const forceSelect = localStorage.getItem('forceWalletSelect');
        if (forceSelect === 'true') {
            await window.ethereum.request({
                method: "wallet_requestPermissions",
                params: [{ eth_accounts: {} }]
            });
            localStorage.removeItem('forceWalletSelect');
        }

        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        await checkNetwork();

        btnConnect.style.display = 'none';
        walletInfo.classList.remove('hidden');
        walletAddress.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;

        fetchBalances();

        // Auto-fill Funder Address if in Batch View
        const funderInput = document.getElementById('batchFunderAddress');
        if (funderInput && !funderInput.value) {
            funderInput.value = userAddress;
            checkFunderBalance();
        }

        window.ethereum.on('accountsChanged', () => location.reload());
        window.ethereum.on('chainChanged', () => location.reload());
    } catch (error) {
        console.error(error);
        if (error.code !== 4001) {
            alert("Error Wallet: " + error.message);
        }
    }
}

async function checkNetwork() {
    const network = await provider.getNetwork();
    if (network.chainId !== 137) {
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_CHAIN_ID }] });
        } catch (e) {
            alert("Cambia a Polygon Mainnet");
        }
    }
}

async function fetchBalances() {
    try {
        const balance = await provider.getBalance(userAddress);
        balanceMatic.textContent = parseFloat(ethers.utils.formatEther(balance)).toFixed(2);

        const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
        const usdcRaw = await usdcContract.balanceOf(userAddress);
        balanceUsdc.textContent = parseFloat(ethers.utils.formatUnits(usdcRaw, 6)).toFixed(2);
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// --- ENVIAR TOKENS ---
// ==========================================

if (btnSend) {
    btnSend.addEventListener('click', sendMatic);
}

async function sendMatic() {
    if (!signer) return alert("❌ Conecta tu Wallet primero");

    const to = txTo.value.trim();
    const amount = txAmount.value;

    if (!ethers.utils.isAddress(to)) return alert("❌ Dirección inválida");
    if (!amount || amount <= 0) return alert("❌ Monto inválido");

    try {
        btnSend.disabled = true;
        btnSend.textContent = "Firmando... ✍️";
        txStatus.textContent = "Esperando confirmación...";

        const tx = await signer.sendTransaction({
            to: to,
            value: ethers.utils.parseEther(amount)
        });

        btnSend.textContent = "Enviando... 🚀";
        txStatus.innerHTML = `Tx enviada: <a href="https://polygonscan.com/tx/${tx.hash}" target="_blank">${tx.hash.substring(0, 8)}...</a>`;

        const receipt = await tx.wait(); // Esperar confirmación
        const gasCostMatic = ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice));

        txStatus.textContent = `✅ Confirmada! Gas: ${parseFloat(gasCostMatic).toFixed(6)} MATIC. Guardando...`;
        await saveTransaction(tx.hash, userAddress, to, amount, gasCostMatic);

        btnSend.textContent = "Enviar 🚀";
        btnSend.disabled = false;
        txTo.value = '';
        txAmount.value = '';
        fetchBalances();

    } catch (error) {
        console.error(error);
        btnSend.disabled = false;
        btnSend.textContent = "Enviar 🚀";
        txStatus.textContent = "❌ Error: " + (error.reason || error.message);
    }
}

// ==========================================
// --- GESTIÓN DE PESTAÑAS (TABS) ---
// ==========================================

window.showTab = function (tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    if (tabName === 'individual') {
        document.getElementById('individualSection').classList.remove('hidden');
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
    } else {
        document.getElementById('batchSection').classList.remove('hidden');
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        fetchBatches(); // Refresh List
    }
};

// ==========================================
// --- GESTIÓN DE LOTES (BATCHES - REFACTOR) ---
// ==========================================

let currentBatchId = null;

// Elementos UI Lotes
const batchListView = document.getElementById('batchListView');
const batchDetailView = document.getElementById('batchDetailView');
const batchesListBody = document.getElementById('batchesListBody');

// Modal Elements
const batchModal = document.getElementById('batchModal');
const btnOpenBatchModal = document.getElementById('btnOpenBatchModal');
const btnSaveBatch = document.getElementById('btnSaveBatch');

// Detail Elements
const detailBatchTitle = document.getElementById('detailBatchTitle');
const detailBatchDesc = document.getElementById('detailBatchDesc');
const statTotalUSDC = document.getElementById('statTotalUSDC');
const statTotalTx = document.getElementById('statTotalTx');
const statSentTx = document.getElementById('statSentTx');
const statStatus = document.getElementById('statStatus');
const detailUploadContainer = document.getElementById('detailUploadContainer');
const btnUploadBatch = document.getElementById('btnUploadBatch');
const uploadStatus = document.getElementById('uploadStatus');
const batchStatsContainer = document.getElementById('batchStatsContainer');
const detailTotalAmount = document.getElementById('detailTotalAmount');
const detailTotalTx = document.getElementById('detailTotalTx');

// Merkle Elements
const merkleContainer = document.getElementById('merkleContainer');
const merkleInputZone = document.getElementById('merkleInputZone');
const merkleResultZone = document.getElementById('merkleResultZone');
const batchFunderAddress = document.getElementById('batchFunderAddress');
const btnGenerateMerkle = document.getElementById('btnGenerateMerkle');
const displayMerkleRoot = document.getElementById('displayMerkleRoot');
const merkleStatus = document.getElementById('merkleStatus');
// New Stats elements
const merkleTotalAmount = document.getElementById('merkleTotalAmount');
const merkleFounderBalance = document.getElementById('merkleFounderBalance');
const merkleResultBalance = document.getElementById('merkleResultBalance');
const merkleResultFunder = document.getElementById('merkleResultFunder');

const batchTableBody = document.getElementById('batchTableBody');

// Event Listeners
if (btnOpenBatchModal) btnOpenBatchModal.onclick = () => batchModal.classList.add('active');
if (btnSaveBatch) btnSaveBatch.onclick = createBatch;
if (btnUploadBatch) btnUploadBatch.onclick = uploadBatchFile;
if (btnGenerateMerkle) btnGenerateMerkle.onclick = generateMerkleTree;

// Merkle Test Listener
const btnTestMerkle = document.getElementById('btnTestMerkle');
if (btnTestMerkle) btnTestMerkle.onclick = runMerkleTest;

// Global functions for HTML access
window.closeBatchModal = () => batchModal.classList.remove('active');

window.showBatchList = function () {
    batchDetailView.classList.add('hidden');
    batchListView.classList.remove('hidden');
    fetchBatches(); // Refresh list
};

// Cargar lista al iniciar o cambiar tab
async function fetchBatches() {
    try {
        const res = await fetch('/api/batches');
        const batches = await res.json();
        renderBatchesList(batches);
    } catch (error) {
        console.error("Error fetching batches:", error);
    }
}

function renderBatchesList(batches) {
    batchesListBody.innerHTML = '';
    if (batches.length === 0) {
        batchesListBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem;">No hay lotes creados. ¡Crea uno nuevo!</td></tr>';
        return;
    }

    batches.forEach(b => {
        const tr = document.createElement('tr');
        const statusBadge = getStatusBadge(b.status);
        const progress = `${b.sent_transactions || 0} / ${b.total_transactions || 0}`;
        // Fix: Divide by 1,000,000 for display
        let totalVal = (b.total_usdc !== null && b.total_usdc !== undefined) ? parseFloat(b.total_usdc) : 0;
        const total = (b.total_usdc !== null) ? `$${(totalVal / 1000000).toFixed(6)}` : '-';
        const date = new Date(b.created_at).toLocaleDateString() + ' ' + new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        tr.innerHTML = `
            <td style="font-weight: bold;">${b.batch_number}</td>
            <td>${b.detail || '-'}</td>
            <td style="font-size: 0.85rem; opacity: 0.8; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${b.description || ''}">${b.description || '-'}</td>
            <td style="font-size: 0.8rem; opacity: 0.7;">${date}</td>
            <td>${statusBadge}</td>
            <td style="color:#4ade80;">${total}</td>
            <td>${progress}</td>
            <td>
                <button class="btn-glass" style="padding: 0.3rem 0.8rem; font-size: 0.8rem;" onclick="openBatchDetail(${b.id})">
                    Ver Detalle 👁️
                </button>
            </td>
        `;
        batchesListBody.appendChild(tr);
    });
}

function getStatusBadge(status) {
    if (status === 'READY') return '<span class="badge" style="background: #3b82f6;">Preparado</span>';
    if (status === 'SENT') return '<span class="badge" style="background: #10b981;">Enviado</span>';
    return '<span class="badge" style="background: #f59e0b; color: #000;">En Preparación</span>';
}

async function createBatch() {
    const data = {
        batch_number: document.getElementById('newBatchNumber').value,
        detail: document.getElementById('newBatchDetail').value,
        description: document.getElementById('newBatchDesc').value,
    };

    if (!data.batch_number || !data.detail) return alert("Completa Número y Detalle");

    try {
        btnSaveBatch.textContent = "Creando...";
        const res = await fetch('/api/batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const responseData = await res.json();

        if (responseData.error) {
            throw new Error(responseData.error);
        }

        // Éxito
        closeBatchModal();
        // Limpiar form
        document.getElementById('newBatchNumber').value = '';
        document.getElementById('newBatchDetail').value = '';
        document.getElementById('newBatchDesc').value = '';

        fetchBatches(); // Recargar lista
        alert("Lote creado exitosamente ✅");

    } catch (error) {
        console.error(error);
        alert("Error creando lote: " + error.message);
    } finally {
        btnSaveBatch.textContent = "Crear Lote";
    }
}

// Global para poder llamarla desde el HTML onclick
window.openBatchDetail = async function (id) {
    currentBatchId = id;
    batchListView.classList.add('hidden');
    batchDetailView.classList.remove('hidden');
    window.scrollTo(0, 0); // Scroll to top for better ux

    // Reset view
    detailBatchTitle.textContent = "Cargando...";
    batchTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';

    try {
        const res = await fetch(`/api/batches/${id}`);
        const data = await res.json();

        if (data.batch) {
            updateDetailView(data.batch, data.transactions);
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
        alert("Error cargando detalle");
        showBatchList();
    }
};

// Pagination State
let currentTxPage = 1;
const txPerPage = 20;
let allBatchTransactions = []; // Store full list

function updateDetailView(batch, txs) {
    detailBatchTitle.textContent = `${batch.batch_number} - ${batch.detail}`;
    detailBatchDesc.textContent = batch.description || "Sin descripción";

    // Stats logic
    if (batchStatsContainer) {
        batchStatsContainer.classList.remove('hidden');
        detailTotalTx.textContent = batch.total_transactions || 0;

        detailTotalTx.textContent = batch.total_transactions || 0;

        let totalValString = (batch.total_usdc !== null && batch.total_usdc !== undefined) ? batch.total_usdc.toString() : "0";
        // Parse directly to BigInt assuming it's stored as base units (WEI/microUSDC) in DB? 
        // Wait, DB usually stores integers.
        // Let's assume it is stored as "6 decimals integer" in DB if it was inserted correctly.
        // But render logic divides by 1000000.
        // So totalValString IS the integer value.
        currentBatchTotalUSDC = BigInt(totalValString);

        const totalDisplay = (parseFloat(totalValString) / 1000000).toFixed(6);
        detailTotalAmount.textContent = `$${totalDisplay}`;
    }

    // Show/Hide Upload based on status
    if (batch.status === 'PREPARING') {
        detailUploadContainer.classList.remove('hidden');
        uploadStatus.textContent = '';
        btnUploadBatch.disabled = false;
        btnUploadBatch.textContent = "Subir y Calcular 📤";
        if (merkleContainer) merkleContainer.classList.add('hidden');
    } else {
        detailUploadContainer.classList.add('hidden');

        // Merkle Logic (For Ready/Sent batches)
        if (merkleContainer) {
            merkleContainer.classList.remove('hidden');
            merkleStatus.textContent = '';

            // Populate Total in Input Section (still Total Amount)
            let totalVal = (batch.total_usdc !== null && batch.total_usdc !== undefined) ? parseFloat(batch.total_usdc) : 0;
            const totalDisplay = `$${(totalVal / 1000000).toFixed(6)}`;
            if (merkleTotalAmount) merkleTotalAmount.textContent = totalDisplay;

            if (batch.merkle_root) {
                // Already generated
                merkleInputZone.classList.add('hidden');
                merkleResultZone.classList.remove('hidden');
                displayMerkleRoot.textContent = batch.merkle_root;

                if (batch.funder_address) {
                    if (merkleResultFunder) merkleResultFunder.textContent = batch.funder_address;

                    // Fetch Funder Balance for Result View
                    if (merkleResultBalance) {
                        merkleResultBalance.textContent = "Cargando...";
                        fetchUSDCBalance(batch.funder_address).then(bal => {
                            merkleResultBalance.textContent = bal;
                        });
                    }
                }
            } else {
                // Not generated yet
                merkleInputZone.classList.remove('hidden');
                merkleResultZone.classList.add('hidden');
                batchFunderAddress.value = ''; // Reset or keep empty
                if (merkleFounderBalance) merkleFounderBalance.textContent = '---';
            }
        }
    }

    // Init Pagination
    allBatchTransactions = txs || [];
    currentTxPage = 1;
    renderBatchTransactions();
}

// Render with Pagination
function renderBatchTransactions() {
    batchTableBody.innerHTML = '';
    const totalItems = allBatchTransactions.length;

    // Pagination Logic
    const start = (currentTxPage - 1) * txPerPage;
    const end = start + txPerPage;
    const pageItems = allBatchTransactions.slice(start, end);

    if (totalItems === 0) {
        batchTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No hay registros</td></tr>';
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
        // User said it's an integer in DB, need to divide. assuming standard 6 decimals for USDC.
        // If DB has 1000000 for 1 USDC:
        const usdcDisplay = (usdcVal / 1000000).toFixed(6);

        tr.innerHTML = `
            <td style="opacity: 0.7;">${tx.transaction_reference || '-'}</td>
            <td style="font-family: monospace; display: flex; align-items: center; gap: 0.5rem;">
                <a href="${scanUrl}" target="_blank" class="hash-link" title="Ver en PolygonScan">
                    ${shortWallet} ↗️
                </a>
                <button class="btn-icon" onclick="copyToClipboard('${tx.wallet_address_to}')" title="Copiar Dirección">
                    📋
                </button>
            </td>
            <td style="color: #4ade80; font-weight: bold;">$${usdcDisplay}</td>
            <td style="font-size: 0.85rem; opacity: 0.7;" title="${tx.tx_hash || ''}">
                ${tx.tx_hash ? `<a href="https://polygonscan.com/tx/${tx.tx_hash}" target="_blank" class="hash-link">${tx.tx_hash.substring(0, 10)}...</a>` : '-'}
            </td>
            <td><span class="badge" style="background: #3b82f6;">${tx.status}</span></td>
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

    if (totalItems <= txPerPage) return; // No pagination needed

    const totalPages = Math.ceil(totalItems / txPerPage);
    const div = document.createElement('div');
    div.id = 'paginationControls';
    div.style.display = 'flex';
    div.style.justifyContent = 'center';
    div.style.gap = '1rem';
    div.style.marginTop = '1rem';
    div.innerHTML = `
        <button class="btn-glass" onclick="changePage(-1)" ${currentTxPage === 1 ? 'disabled' : ''}>⬅️ Anterior</button>
        <span style="align-self: center;">Página ${currentTxPage} de ${totalPages}</span>
        <button class="btn-glass" onclick="changePage(1)" ${currentTxPage === totalPages ? 'disabled' : ''}>Siguiente ➡️</button>
    `;

    // Append after table container
    const tableContainer = document.querySelector('#batchDetailView .table-container');
    tableContainer.parentNode.insertBefore(div, tableContainer.nextSibling);
}

window.changePage = function (direction) {
    currentTxPage += direction;
    renderBatchTransactions();
};

// Upload Logic restored
async function uploadBatchFile() {
    const fileInput = document.getElementById('batchFile');
    if (!fileInput.files[0]) return alert("Selecciona un archivo Excel");
    if (!currentBatchId) return alert("No hay lote activo");

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        btnUploadBatch.textContent = "Procesando...";
        btnUploadBatch.disabled = true;
        uploadStatus.textContent = "Leyendo Excel y Calculando...";

        const res = await fetch(`/api/batches/${currentBatchId}/upload`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();

        if (result.batch) {
            updateDetailView(result.batch, result.transactions);
            uploadStatus.textContent = "✅ Carga exitosa";
        } else {
            throw new Error(result.error || "Error en respuesta");
        }

    } catch (error) {
        console.error(error);
        uploadStatus.textContent = "❌ Error: " + error.message;
    } finally {
        btnUploadBatch.textContent = "Subir y Calcular 📤";
        btnUploadBatch.disabled = false;
    }
}

async function generateMerkleTree() {
    if (!currentBatchId) return;

    // Check if wallet is connected
    if (!userAddress || !signer) {
        if (confirm("⚠️ Debes conectar tu Wallet Funder para generar el Merkle Tree. ¿Deseas conectarla ahora?")) {
            await connectWallet();
            // After connection, the input should be auto-filled, but let's be sure
            if (!userAddress) return;
        } else {
            return;
        }
    }

    const funder = batchFunderAddress.value.trim();

    if (!funder || !ethers.utils.isAddress(funder)) {
        return alert("Ingresa una dirección de Funder válida");
    }

    try {
        btnGenerateMerkle.disabled = true;
        btnGenerateMerkle.textContent = "Generando...";
        merkleStatus.textContent = "Calculando árbol criptográfico...";

        const res = await fetch(`/api/batches/${currentBatchId}/merkle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ funder_address: funder })
        });
        const data = await res.json();

        if (data.root) {
            // Update UI directly to avoid full reload flicker, or just reload logic
            merkleInputZone.classList.add('hidden');
            merkleResultZone.classList.remove('hidden');
            displayMerkleRoot.textContent = data.root;
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
        btnGenerateMerkle.textContent = "Generar Merkle Tree ⚙️";
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

    if (!allBatchTransactions || allBatchTransactions.length === 0) {
        alert("⚠️ No hay transacciones para probar");
        return;
    }

    // Parameters
    const SAMPLE_PERCENT = 0.10; // 10%
    const MAX_CONCURRENT = 50;

    // 1. Select Sample
    const sampleSize = Math.max(1, Math.ceil(allBatchTransactions.length * SAMPLE_PERCENT));
    const shuffled = [...allBatchTransactions].sort(() => 0.5 - Math.random());
    const selectedTxs = shuffled.slice(0, sampleSize);

    // UI Setup
    const btn = document.getElementById('btnTestMerkle');
    const status = document.getElementById('merkleTestStatus');
    const funderText = document.getElementById('merkleResultFunder').textContent.trim();

    // Determine Funder Address
    let funder = funderText;
    if (!funder || funder === '---' || !ethers.utils.isAddress(funder)) {
        // Fallback to value input if just generated
        funder = batchFunderAddress.value.trim();
    }
    if (!ethers.utils.isAddress(funder)) {
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
        let testProvider = provider;
        if (!testProvider) {
            const configRes = await fetch('/api/config');
            const config = await configRes.json();
            testProvider = new ethers.providers.JsonRpcProvider(config.RPC_URL || "https://polygon-rpc.com");
        }

        const abi = ["function validateMerkleProofDetails(uint256, uint256, address, address, uint256, bytes32, bytes32[]) external view returns (bool)"];

        // Use Configured Address
        const targetContract = APP_CONFIG.CONTRACT_ADDRESS;
        if (!targetContract) throw new Error("Contract Address not loaded in Config");

        const contract = new ethers.Contract(targetContract, abi, testProvider);

        let completed = 0;
        let failed = 0;

        // Task Function per Transaction
        const runVerificationTask = async (tx) => {
            try {
                // Fetch Proof from Backend
                const proofRes = await fetch(`/api/batches/${currentBatchId}/transactions/${tx.id}/proof`);
                if (!proofRes.ok) throw new Error("API Error fetching proof");
                const proofData = await proofRes.json();

                if (!proofData.proof) throw new Error("No Proof Data");

                const amountVal = ethers.BigNumber.from(tx.amount_usdc);

                // Verify On-Chain (View Call)
                const isValid = await contract.validateMerkleProofDetails(
                    ethers.BigNumber.from(currentBatchId),
                    ethers.BigNumber.from(tx.id),
                    funder,
                    tx.wallet_address_to,
                    amountVal,
                    merkleRoot,
                    proofData.proof
                );

                if (!isValid) throw new Error("❌ Invalid On-Chain Result");

            } catch (err) {
                console.error(`Verification Failed [TxID: ${tx.id}]`, err);
                failed++;
            } finally {
                completed++;
                if (status) status.textContent = `⏳ Progreso: ${completed}/${sampleSize} verificados (Fallos: ${failed})`;
            }
        };

        // Execution Queue (Worker Pool Pattern)
        const queue = [...selectedTxs];
        const workers = [];

        const worker = async () => {
            while (queue.length > 0) {
                const tx = queue.shift();
                await runVerificationTask(tx);
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
    if (!address || !ethers.utils.isAddress(address)) {
        if (merkleFounderBalance) merkleFounderBalance.textContent = "---";
        return;
    }

    if (merkleFounderBalance) merkleFounderBalance.textContent = "Cargando...";

    try {
        const balanceStr = await fetchUSDCBalance(address);
        if (merkleFounderBalance) {
            merkleFounderBalance.textContent = balanceStr;
        }
    } catch (error) {
        console.error("Balance Error:", error);
        if (merkleFounderBalance) merkleFounderBalance.textContent = "Error";
    }
}
window.checkFunderBalance = checkFunderBalance;

async function fetchUSDCBalance(address) {
    if (!address || !ethers.utils.isAddress(address)) return "---";
    try {
        let provider;
        if (window.ethereum) {
            provider = new ethers.providers.Web3Provider(window.ethereum);
        } else {
            provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
        }
        const usdcAddress = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
        const minABI = ["function balanceOf(address owner) view returns (uint256)"];
        const contract = new ethers.Contract(usdcAddress, minABI, provider);
        const usdcBal = await contract.balanceOf(address);
        const usdcFormatted = ethers.utils.formatUnits(usdcBal, 6);
        return `$${parseFloat(usdcFormatted).toFixed(6)} USDC`;
    } catch (e) {
        console.error("Fetch Balance Error", e);
        return "Error";
    }
}
window.fetchUSDCBalance = fetchUSDCBalance;

// Relayer Processing Handler
const btnProcessBatch = document.getElementById('btnProcessBatch');
const relayerCountSelect = document.getElementById('relayerCount');
const processStatus = document.getElementById('processStatus');

if (btnProcessBatch) {
    btnProcessBatch.addEventListener('click', async () => {
        if (!currentBatchId) return;
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
                const requiredFmt = ethers.utils.formatUnits(currentBatchTotalUSDC, 6);
                const foundFmt = ethers.utils.formatUnits(userBal, 6);
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

        await executeBatchDistribution(count, permitData, rootSignatureData);
    });
}

async function executeBatchDistribution(count, permitData = null, rootSignatureData = null) {
    btnProcessBatch.disabled = true;
    processStatus.textContent = "Iniciando motor de relayers... ⏳";
    processStatus.style.color = "#fbbf24";

    // Optimistic UI: Mostrar placeholders de inmediato
    const tbody = document.getElementById('relayerBalancesTableBody');
    if (tbody) {
        tbody.innerHTML = '';
        for (let i = 0; i < count; i++) {
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding:0.75rem; color:#94a3b8;">Generando Relayer ${i + 1}...</td>
                    <td style="padding:0.75rem; color:#64748b;">0.0000 MATIC</td>
                    <td style="padding:0.75rem; color:#64748b;">Iniciando...</td>
                </tr>
            `;
        }
    }

    try {
        const response = await fetch(`/api/batches/${currentBatchId}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                relayerCount: count,
                permitData: permitData,
                rootSignatureData: rootSignatureData
            })
        });
        const res = await response.json();

        if (response.ok) {
            processStatus.textContent = "✅ Procesando. Los relayers están recibiendo gas.";
            processStatus.style.color = "#4ade80";

            // Update button immediately
            btnProcessBatch.disabled = true;
            btnProcessBatch.innerHTML = "✅ Distribución Iniciada";
            btnProcessBatch.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";

            // Start Timer
            startTimer();

            // Iniciar Polling Rápido (cada 2 segundos)
            if (window.balanceInterval) clearInterval(window.balanceInterval);
            window.balanceInterval = setInterval(() => {
                fetchRelayerBalances(currentBatchId);
            }, 2000);

            // Primer refresco inmediato (500ms) ya que la API espera a que estén en BD
            setTimeout(() => fetchRelayerBalances(currentBatchId), 500);
        } else {
            console.error("Distribution Error:", res.error);
            processStatus.textContent = "❌ Error: " + res.error;
            processStatus.style.color = "#ef4444";
            btnProcessBatch.disabled = false;
            stopTimer(); // Ensure timer stops on error check
            fetchRelayerBalances(currentBatchId);
        }
    } catch (err) {
        console.error(err);
        processStatus.textContent = "❌ Error de conexión";
        btnProcessBatch.disabled = false;
    }
}

// --- Permit Signing Logic ---
async function signBatchPermit(batchId) {
    processStatus.textContent = "Solicitando firma de Permit... ✍️";
    processStatus.style.color = "#fbbf24";

    // 1. Get Batch Total
    const res = await fetch(`/api/batches/${batchId}`);
    const data = await res.json();
    if (!data.batch) throw new Error("Batch not found");

    // Total USDC from batch
    const totalUSDC = ethers.BigNumber.from(data.batch.total_usdc || "0");
    const totalTx = parseInt(data.batch.total_transactions || "0");

    if (totalUSDC.isZero()) {
        console.warn("Batch total is zero, skipping permit.");
        return null;
    }

    // 2. Get Current Allowance & Nonce
    const usdcAbi = [
        "function nonces(address) view returns (uint256)",
        "function allowance(address, address) view returns (uint256)",
        "function name() view returns (string)",
        "function version() view returns (string)"
    ];
    const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer); // signer is global

    const nonce = await usdcContract.nonces(userAddress);
    // Check Allowance
    const allowance = await usdcContract.allowance(userAddress, APP_CONFIG.CONTRACT_ADDRESS);

    // Additive Permit Logic (Current Allowance + New Batch)
    const value = allowance.add(totalUSDC);

    // Dynamic Deadline Calculation
    // Base: 1 hour
    // Per Tx: 2 minutes (conservative for congestion/retries)
    // Min: 2 hours
    const BASE = 3600;
    const PER_TX = 120;
    const variable = totalTx * PER_TX;
    const duration = Math.max(7200, BASE + variable);

    const deadline = Math.floor(Date.now() / 1000) + duration;
    console.log(`[Permit] Dynamic Deadline: +${(duration / 3600).toFixed(1)}h (TxCount: ${totalTx})`);
    console.log(`[Permit] Expiry Time: ${new Date(deadline * 1000).toLocaleString()}`);
    console.log(`[Permit] Total Approved Value: ${ethers.utils.formatUnits(value, 6)} USDC`);

    const chainId = (await provider.getNetwork()).chainId;

    const domain = {
        name: 'USD Coin',
        version: '1',
        chainId: chainId,
        verifyingContract: USDC_ADDRESS
    };

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
        version: "2",
        spender: APP_CONFIG.CONTRACT_ADDRESS,
        value: value,
        value: value.toString(), // Ethers v5 signTypedData handles string/BN
        nonce: nonce.toString(),
        deadline: deadline
    };

    const signature = await signer._signTypedData(domain, types, message);
    const { v, r, s } = ethers.utils.splitSignature(signature);

    return {
        v, r, s,
        deadline,
        amount: value.toString(), // Send as string to backend
        signature,
        // Optional: Include owner/spender for verification
        owner: userAddress,
        owner: userAddress,
        spender: APP_CONFIG.CONTRACT_ADDRESS,
        value: value,
    };
}

async function signBatchRoot(batchId) {
    if (!signer || !userAddress) throw new Error("Wallet no conectada");

    // 1. Get Batch Info (Need tx count and total amount for explicit signing)
    const res = await fetch(`/api/batches/${batchId}`);
    const data = await res.json();
    if (!data.batch) throw new Error("Lote no encontrado");

    const rootEl = document.getElementById('displayMerkleRoot');
    const merkleRoot = rootEl ? rootEl.textContent.trim() : null;

    if (!merkleRoot || !merkleRoot.startsWith("0x")) {
        throw new Error("No hay Merkle Root válido generado para firmar.");
    }

    // Explicit Metadata for EIP-712
    const totalTransactions = data.batch.total_transactions || 0;
    const totalAmountBase = data.batch.total_usdc || "0";
    const totalAmountHuman = (parseFloat(totalAmountBase) / 1000000).toFixed(2);

    // 2. Fetch Nonce from Contract
    const minABI = ["function nonces(address owner) view returns (uint256)"];
    // 4. Send Signature + Root to Backend to execute
    // Note: We need the Relayer to submit this. For now we just store it or call a relay endpoint
    // Actually, we use the RelayerEngine in backend. 
    // We just need to ensure the backend receives this signature.

    // For ATOMIC execution, we might want to call the contract directly IF we are not using relayers?
    // But the requirement says "Gasless". So we must send to backend.

    // ... (Existing logic continues) ...
    // Verify Contract Connection for display purposes
    const contract = new ethers.Contract(APP_CONFIG.CONTRACT_ADDRESS, minABI, provider);
    const nonce = await contract.nonces(userAddress);

    const network = await provider.getNetwork();
    const chainId = network.chainId;

    console.log(`[RootSign] EIP-712 signing root ${merkleRoot} | Txs: ${totalTransactions} | Amount: ${totalAmountHuman} USDC`);

    // 3. Construct EIP-712 Data
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

    // This will trigger a Metamask prompt with clear fields
    const signature = await signer._signTypedData(domain, types, message);

    return {
        merkleRoot,
        signature,
        funder: userAddress,
        totalTransactions,
        totalAmount: totalAmountBase
    };
}

// --- Timer Logic ---
function startTimer() {
    const timerEl = document.getElementById('processTimer');
    if (!timerEl) return;

    // Reset style
    timerEl.style.display = 'block';
    timerEl.style.color = '#f59e0b';
    timerEl.textContent = '00:00:00';

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
    if (window.processTimerInterval) clearInterval(window.processTimerInterval);
    const timerEl = document.getElementById('processTimer');
    if (timerEl) timerEl.style.color = '#ef4444'; // Red if stopped/error
}

// --- Faucet & Relayer Management Logic ---

window.openFaucetModal = () => {
    const modal = document.getElementById('faucetModal');
    if (modal) modal.classList.remove('hidden');
    refreshRelayerBalances();
};

window.closeFaucetModal = () => {
    const modal = document.getElementById('faucetModal');
    if (modal) modal.classList.add('hidden');
};

async function fetchRelayerBalances(batchId) {
    const tbody = document.getElementById('relayerBalancesTableBody');
    console.log(`[RelayerDebug] Fetching balances for batch: ${batchId}`);
    try {
        const response = await fetch(`/api/relayers/${batchId}`);
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Fallo en servidor');
        }
        const data = await response.json();
        console.log(`[RelayerDebug] Received ${data.length} relayers`);
        renderRelayerBalances(data);
    } catch (err) {
        console.error('Error fetching relayer balances:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1rem; color:#ef4444;">⚠️ Error: ${err.message}</td></tr>`;
        }
    }
}

function renderRelayerBalances(data) {
    const tbody = document.getElementById('relayerBalancesTableBody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1rem;">No hay relayers activos para este lote</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(r => {
        const shortAddr = `${r.address.substring(0, 6)}...${r.address.substring(38)}`;
        const isStale = r.isStale === true;
        const balanceDisplay = isStale ? `${parseFloat(r.balance).toFixed(4)} MATIC <span style="font-size: 0.7rem; color: #fbbf24;">(Persistente 💾)</span>` : `${parseFloat(r.balance).toFixed(4)} MATIC`;
        const balanceColor = isStale ? '#fbbf24' : '#4ade80';

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:0.75rem; color:#94a3b8; font-size:0.8rem; font-weight:bold;">#${r.id}</td>
                <td style="padding:0.75rem; font-family:monospace; font-size:0.85rem;">
                    <a href="${getExplorerUrl(r.address)}" target="_blank" class="hash-link">
                        ${shortAddr} ↗️
                    </a>
                </td>
                <td style="padding:0.75rem; color:${balanceColor}; font-weight:bold;">
                    ${balanceDisplay}
                </td>
                <td style="padding:0.75rem; color:#94a3b8; font-size:0.8rem;">
                    ${r.lastActivity ? new Date(r.lastActivity).toLocaleTimeString() : 'Sin actividad'}
                </td>
                <td style="padding:0.75rem; font-family:monospace; font-size:0.85rem;">
                    ${r.transactionHashDeposit ? `<a href="https://polygonscan.com/tx/${r.transactionHashDeposit}" target="_blank" class="hash-link">🔗 Tx</a>` : '-'}
                </td>
            </tr>
        `;
    }).join('');

    // IDEMPOTENCY: Hide distribution controls if relayers exist
    const btnProcessBatch = document.getElementById('btnProcessBatch');
    const btnDistributeGas = document.getElementById('btnDistributeGas');
    const processStatus = document.getElementById('processStatus');

    if (data.length > 0) {
        // Special case: if we have relayers but the status is still PROCESSING,
        // we allow "Continuar" instead of just blocking.
        const isFinished = processStatus && (processStatus.textContent.includes("✅") || processStatus.textContent.includes("Terminado"));

        if (btnProcessBatch) {
            if (!isFinished) {
                btnProcessBatch.disabled = false;
                btnProcessBatch.innerHTML = "Re-intentar / Continuar 🔥";
                btnProcessBatch.style.background = "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)";
                btnProcessBatch.style.cursor = "pointer";
            } else {
                btnProcessBatch.disabled = true;
                btnProcessBatch.innerHTML = "✅ Distribución Finalizada";
                btnProcessBatch.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
                btnProcessBatch.style.cursor = "default";
            }
        }
        if (btnDistributeGas) {
            btnDistributeGas.disabled = true;
            btnDistributeGas.textContent = "Gas Distribuido";
        }
        if (processStatus && !processStatus.textContent.includes("Procesando") && !isFinished) {
            processStatus.innerHTML = "ℹ️ Reanudar: Puedes reactivar los relayers si el proceso se detuvo.";
            processStatus.style.color = "#60a5fa";
        }
    }
}

window.triggerGasDistribution = async () => {
    if (!currentBatchId) return alert("Seleccione un lote primero");

    // Get count from whichever input is available (Modal or Main)
    const modalInput = document.getElementById('relayerCountInput');
    const mainSelect = document.getElementById('relayerCount');
    const count = parseInt(modalInput?.value || mainSelect?.value) || 5;

    const modalStatus = document.getElementById('modalFaucetStatus');
    if (modalStatus) {
        modalStatus.textContent = "⌛ Iniciando distribución...";
        modalStatus.style.color = "#fbbf24";
    }

    await executeBatchDistribution(count);
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
setInterval(() => {
    if (currentBatchId && !window.processingBatch) {
        refreshRelayerBalances();
    }
    checkFaucetStatus();
}, 60000);

// Initial calls
checkFaucetStatus();
refreshRelayerBalances();


