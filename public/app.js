const API_TRANSACTIONS = '/api/transactions';

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
const USDC_ABI = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];
let provider, signer, userAddress;

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
const batchTableBody = document.getElementById('batchTableBody');

// Event Listeners
if (btnOpenBatchModal) btnOpenBatchModal.onclick = () => batchModal.classList.add('active');
if (btnSaveBatch) btnSaveBatch.onclick = createBatch;
if (btnUploadBatch) btnUploadBatch.onclick = uploadBatchFile;

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
        // Fix: Check strict null so 0 is displayed
        const total = (b.total_usdc !== null && b.total_usdc !== undefined) ? `$${parseFloat(b.total_usdc).toFixed(2)}` : '-';
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

    // Reset view
    detailBatchTitle.textContent = "Cargando...";
    batchTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Cargando...</td></tr>';

    try {
        const res = await fetch(`/api/batches/${id}`);
        const data = await res.json();

        if (data.batch) {
            updateDetailView(data.batch, data.transactions);
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

    // Stats Removed per user request

    // Show/Hide Upload based on status
    if (batch.status === 'PREPARING') {
        detailUploadContainer.classList.remove('hidden');
        uploadStatus.textContent = '';
        btnUploadBatch.disabled = false;
        btnUploadBatch.textContent = "Subir y Calcular 📤";
    } else {
        detailUploadContainer.classList.add('hidden');
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
        tr.innerHTML = `
            <td style="opacity: 0.7;">${tx.transaction_reference || '-'}</td>
            <td style="font-family: monospace;" title="${tx.wallet_address}">${tx.wallet_address}</td>
            <td style="color: #4ade80;">$${parseFloat(tx.amount_usdc).toFixed(2)}</td>
            <td style="font-size: 0.85rem; opacity: 0.7;" title="${tx.tx_hash || ''}">${tx.tx_hash ? tx.tx_hash.substring(0, 10) + '...' : '-'}</td>
            <td><span class="badge" style="background: #3b82f6;">${tx.status}</span></td>
        `;
        batchTableBody.appendChild(tr);
    });

    renderPaginationControls(totalItems);
}

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
