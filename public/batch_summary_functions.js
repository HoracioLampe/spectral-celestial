
// ============================================
// BATCH COMPLETION SUMMARY FUNCTIONS
// ============================================

// Global variable to store current batch data
let currentBatchSummary = null;

// Show batch completion summary modal
window.showBatchCompletionSummary = async function (batchId) {
    try {
        // Fetch batch details
        const response = await fetch(`/api/batches/${batchId}`);
        const batch = await response.json();

        if (!batch) {
            console.error('Batch not found');
            return;
        }

        // Store for download function
        currentBatchSummary = batch;

        // Populate modal fields
        document.getElementById('summaryBatchId').textContent = batch.id || '-';
        document.getElementById('summaryBatchName').textContent = batch.batch_name || 'Sin nombre';

        // Format dates
        const startDate = batch.start_time ? new Date(batch.start_time).toLocaleString('es-AR') : '-';
        const endDate = batch.end_time ? new Date(batch.end_time).toLocaleString('es-AR') : '-';
        document.getElementById('summaryStartTime').textContent = startDate;
        document.getElementById('summaryEndTime').textContent = endDate;

        // Duration
        document.getElementById('summaryDuration').textContent = batch.execution_time || '-';

        // Gas used
        const gasUsed = batch.total_gas_used || '0';
        document.getElementById('summaryGasUsed').textContent = `${parseFloat(gasUsed).toFixed(4)} MATIC`;

        // Transaction count
        const completed = batch.stats?.completed || 0;
        const failed = batch.stats?.failed || 0;
        const total = batch.total_transactions || 0;
        document.getElementById('summaryTxCount').textContent = `${completed} / ${total}${failed > 0 ? ` (${failed} fallidas)` : ''}`;

        // USDC sent
        const usdcSent = batch.total_usdc ? (parseFloat(batch.total_usdc) / 1000000).toFixed(2) : '0.00';
        document.getElementById('summaryUsdcSent').textContent = `${usdcSent} USDC`;

        // Show modal
        const modal = document.getElementById('batchSummaryModal');
        if (modal) {
            modal.classList.add('active');
        }
    } catch (error) {
        console.error('Error showing batch summary:', error);
        alert('Error al cargar el resumen del batch');
    }
};

// Close batch summary modal
window.closeBatchSummary = function () {
    const modal = document.getElementById('batchSummaryModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

// Download batch receipt as Excel/CSV
window.downloadBatchReceipt = async function () {
    if (!currentBatchSummary) {
        alert('No hay datos del batch para descargar');
        return;
    }

    try {
        const batchId = currentBatchSummary.id;

        // Fetch all transactions for this batch
        const response = await fetch(`/api/batches/${batchId}/transactions`);
        const transactions = await response.json();

        if (!transactions || transactions.length === 0) {
            alert('No hay transacciones para descargar');
            return;
        }

        // Create CSV content
        const headers = ['Nro', 'Wallet Address', 'Monto USDC', 'Transaction Hash', 'Estado', 'Fecha/Hora'];
        const csvRows = [headers.join(',')];

        transactions.forEach((tx, index) => {
            const row = [
                index + 1,
                `"${tx.wallet_address_to || ''}"`,
                (parseFloat(tx.amount_usdc || 0) / 1000000).toFixed(6),
                `"${tx.tx_hash || 'Pendiente'}"`,
                tx.status || 'UNKNOWN',
                tx.updated_at ? new Date(tx.updated_at).toLocaleString('es-AR') : '-'
            ];
            csvRows.push(row.join(','));
        });

        const csvContent = csvRows.join('\\n');

        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `Batch_${batchId}_${currentBatchSummary.batch_name || 'Recibo'}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        console.log(`✅ Recibo descargado: ${transactions.length} transacciones`);
    } catch (error) {
        console.error('Error downloading receipt:', error);
        alert('Error al descargar el recibo');
    }
};

// Add this code to the end of app.js
