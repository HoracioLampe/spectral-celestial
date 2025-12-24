const API_TRANSACTIONS = '/api/transactions';

// --- Elementos DOM ---
const transactionsTableBody = document.getElementById('transactionsTableBody');
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect'); // Nuevo botón
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
        transactionsTableBody.innerHTML = '<tr><td colspan="5" style="color: #ff6b6b; text-align: center;">Error cargando historial</td></tr>';
    }
}

// ...
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
//...
// (Inside sendMatic)
const receipt = await tx.wait(); // Esperar confirmación

// Calcular Gas Cost: Gas Used * Effective Gas Price
const gasUsedBN = receipt.gasUsed;
const gasPriceBN = receipt.effectiveGasPrice;
const gasCostBN = gasUsedBN.mul(gasPriceBN);
const gasCostMatic = ethers.utils.formatEther(gasCostBN);

txStatus.textContent = "✅ Confirmada! Guardando...";

// Guardar en nuestra DB con Gas
await saveTransaction(tx.hash, userAddress, to, amount, gasCostMatic);

btnSend.textContent = "Enviar 🚀";
//...

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
    // 1. Ocultar info de wallet
    walletInfo.classList.add('hidden');
    btnConnect.style.display = 'block';

    // 2. Limpiar variables locales
    userAddress = null;
    signer = null;
    provider = null;

    // 3. Marcar flag para forzar selección al reconectar
    localStorage.setItem('forceWalletSelect', 'true');
    console.log("🔌 Desconectado (Simulado). Próxima conexión pedirá cuenta.");
}

async function connectWallet() {
    if (!window.ethereum) return alert("⚠️ Instala MetaMask");
    try {
        const forceSelect = localStorage.getItem('forceWalletSelect');

        // Si venimos de un "Logout", forzamos el selector de cuentas
        if (forceSelect === 'true') {
            await window.ethereum.request({
                method: "wallet_requestPermissions",
                params: [{ eth_accounts: {} }]
            });
            localStorage.removeItem('forceWalletSelect');
        }

        provider = new ethers.providers.Web3Provider(window.ethereum);

        // Solicitar cuentas (si ya hay permisos, las devuelve directo)
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
        // Si el usuario cancela, no mostramos alerta intrusiva
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

        await tx.wait(); // Esperar confirmación en Blockchain

        txStatus.textContent = "✅ Confirmada! Guardando...";

        // Guardar en nuestra DB
        await saveTransaction(tx.hash, userAddress, to, amount);

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
