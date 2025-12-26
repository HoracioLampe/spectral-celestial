const API_TRANSACTIONS = '/api/transactions';

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
                modalLink.href = `https://polygonscan.com/address/${data.address}`;
                modalLink.dataset.address = data.address;
            }

            if (faucetBalanceSpan) faucetBalanceSpan.textContent = `${parseFloat(data.balance).toFixed(4)} MATIC`;
            if (faucetKeySpan) faucetKeySpan.textContent = data.privateKey || "---";

            // Main Faucet Link
            const mainLink = document.getElementById('mainFaucetLink');
            if (mainLink) {
                mainLink.textContent = `${shortAddr} ↗️`;
                mainLink.href = `https://polygonscan.com/address/${data.address}`;
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
                faucetStatus.textContent = "❌ No hay Faucet. Haz clic en 'Generar Faucet'.";
                faucetStatus.style.color = "#ef4444";
            }
            if (mainAddress) mainAddress.textContent = "No configurado";
        }
    } catch (err) {
        console.error('Error checking faucet:', err);
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
setInterval(checkFaucetStatus, 15000);
document.addEventListener('DOMContentLoaded', checkFaucetStatus);

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

        let totalVal = (batch.total_usdc !== null && batch.total_usdc !== undefined) ? parseFloat(batch.total_usdc) : 0;
        const totalDisplay = (totalVal / 1000000).toFixed(6);
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

async function checkFounderBalance() {
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
window.checkFounderBalance = checkFounderBalance;

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

        await executeBatchDistribution(count);
    });
}

async function executeBatchDistribution(count) {
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
            body: JSON.stringify({ relayerCount: count })
        });
        const res = await response.json();

        if (response.ok) {
            processStatus.textContent = "✅ Procesando. Los relayers están recibiendo gas.";
            processStatus.style.color = "#4ade80";

            // Iniciar Polling Rápido (cada 2 segundos)
            if (window.balanceInterval) clearInterval(window.balanceInterval);
            window.balanceInterval = setInterval(() => {
                fetchRelayerBalances(currentBatchId);
            }, 2000);

            // Primer refresco inmediato (500ms) ya que la API espera a que estén en BD
            setTimeout(() => fetchRelayerBalances(currentBatchId), 500);
        } else {
            processStatus.textContent = "❌ Error: " + res.error;
            processStatus.style.color = "#ef4444";
            btnProcessBatch.disabled = false;
            fetchRelayerBalances(currentBatchId);
        }
    } catch (err) {
        console.error(err);
        processStatus.textContent = "❌ Error de conexión";
        btnProcessBatch.disabled = false;
    }
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
    try {
        const response = await fetch(`/api/relayers/${batchId}`);
        if (!response.ok) throw new Error('Error al obtener balances');
        const data = await response.json();
        renderRelayerBalances(data);
    } catch (err) {
        console.error('Error fetching relayer balances:', err);
    }
}

function renderRelayerBalances(data) {
    const tbody = document.getElementById('relayerBalancesTableBody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:1rem;">No hay relayers activos para este lote</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(r => {
        const shortAddr = `${r.address.substring(0, 6)}...${r.address.substring(38)}`;
        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:0.75rem; font-family:monospace; font-size:0.85rem;">
                    <a href="https://polygonscan.com/address/${r.address}" target="_blank" class="hash-link">
                        ${shortAddr} ↗️
                    </a>
                </td>
                <td style="padding:0.75rem; color:#4ade80; font-weight:bold;">
                    ${parseFloat(r.balance).toFixed(4)} MATIC
                </td>
                <td style="padding:0.75rem; color:#94a3b8; font-size:0.8rem;">
                    ${r.lastActivity ? new Date(r.lastActivity).toLocaleTimeString() : 'Sin actividad'}
                </td>
            </tr>
        `;
    }).join('');
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

// Auto-refresh every 15s normally, but executeBatchDistribution handles high-speed polling
setInterval(() => {
    if (currentBatchId && !window.processingBatch) {
        refreshRelayerBalances();
    }
}, 15000);


