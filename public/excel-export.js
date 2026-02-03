// Excel Export Function for Transaction Grid
// Fetches complete data from API with applied filters
async function exportToExcel() {
    try {
        // Get current batch ID from global variable or currentBatchSummary
        let batchId = window.activeBatchId || window.currentBatchSummary?.id;

        // Try to get from URL hash (e.g., #batch-123)
        if (!batchId && window.location.hash) {
            const hashMatch = window.location.hash.match(/#batch-(\d+)/);
            if (hashMatch) {
                batchId = hashMatch[1];
            }
        }

        // PRIORITY: Try to get from "ID de Lote: XXX" badge (most visible element)
        if (!batchId) {
            const allText = document.body.innerText;
            const loteMatch = allText.match(/ID\s+de\s+Lote:\s*(\d+)/i);
            if (loteMatch) {
                batchId = loteMatch[1];
                console.log(`✅ Batch ID detectado desde badge "ID de Lote": ${batchId}`);
            }
        }

        // Try to get from the potencia/relayer dropdown or select element
        if (!batchId) {
            const potenciaSelect = document.querySelector('select[id*="potencia"], select[id*="relayer"]');
            if (potenciaSelect && potenciaSelect.selectedOptions[0]) {
                const selectedText = potenciaSelect.selectedOptions[0].textContent;
                const selectMatch = selectedText.match(/^(\d+)/);
                if (selectMatch) {
                    batchId = selectMatch[1];
                }
            }
        }

        // Try to get from visible batch detail section title or header
        if (!batchId) {
            const batchTitleElement = document.querySelector('.batch-detail-title, .section-title, h2, h3, .card-header');
            if (batchTitleElement) {
                const titleText = batchTitleElement.textContent;
                const titleMatch = titleText.match(/Batch[:\s#]*(\d+)/i) ||
                    titleText.match(/Lote[:\s#]*(\d+)/i) ||
                    titleText.match(/Ejecución.*?(\d+)/i) ||
                    titleText.match(/#(\d+)/);
                if (titleMatch) {
                    batchId = titleMatch[1];
                }
            }
        }

        // Try to get from visible batch info elements
        if (!batchId) {
            const batchInfoElement = document.querySelector('[data-batch-id]') ||
                document.getElementById('currentBatchId') ||
                document.querySelector('.batch-id, .batch-number');
            if (batchInfoElement) {
                batchId = batchInfoElement.getAttribute('data-batch-id') ||
                    batchInfoElement.dataset.batchId ||
                    batchInfoElement.textContent.trim().match(/\d+/)?.[0];
            }
        }

        // Try to extract from transaction detail section specifically
        if (!batchId) {
            const detailSection = document.querySelector('.transaction-detail, .batch-detail, [class*="detail"]');
            if (detailSection) {
                const sectionText = detailSection.innerText;
                const detailMatch = sectionText.match(/(?:Batch|Lote|Ejecución|#)\s*(\d+)/i);
                if (detailMatch) {
                    batchId = detailMatch[1];
                }
            }
        }

        // Try to extract from any visible text containing "Batch" or "Lote" followed by a number
        if (!batchId) {
            const allText = document.body.innerText;
            const batchMatch = allText.match(/(?:Batch|Lote|#)\s*(\d+)/i);
            if (batchMatch) {
                batchId = batchMatch[1];
            }
        }

        // Last resort: prompt user
        if (!batchId) {
            batchId = prompt('Por favor, ingresa el ID del batch a exportar:');
            if (!batchId) {
                return; // User cancelled
            }
        }

        // Get applied filters from UI
        const filterWallet = document.getElementById('filterWallet')?.value || '';
        const filterAmount = document.getElementById('filterAmount')?.value || '';
        const filterStatus = document.getElementById('filterStatus')?.value || '';

        // Show loading indicator
        const btn = event?.target;
        const originalText = btn?.innerHTML;
        if (btn) btn.innerHTML = '⏳ Generando Excel...';

        // Build query params with filters
        const params = new URLSearchParams({
            batchId: batchId,
            wallet: filterWallet,
            amount: filterAmount,
            status: filterStatus
        });

        // Get JWT token for authentication
        const token = localStorage.getItem('jwt_token');
        if (!token) {
            alert('⚠️ Sesión expirada. Por favor, inicia sesión nuevamente.');
            if (btn) btn.innerHTML = originalText;
            return;
        }

        // Fetch complete transaction data from API with filters and authentication
        const response = await fetch(`/api/transactions?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.status === 401 || response.status === 403) {
            alert('⚠️ No autorizado. Por favor, inicia sesión nuevamente.');
            if (btn) btn.innerHTML = originalText;
            return;
        }

        if (!response.ok) {
            throw new Error('Error al obtener datos del servidor');
        }

        const transactions = await response.json();

        if (!transactions || transactions.length === 0) {
            alert('⚠️ No hay transacciones para exportar con los filtros aplicados');
            if (btn) btn.innerHTML = originalText;
            return;
        }

        // Calculate offset: first transaction ID from results minus 1
        // This way numbering starts from where the export begins
        const offset = transactions.length > 0 ? (transactions[0].id - 1) : 0;

        // Prepare data array for Excel
        const data = [];

        // Add header row
        data.push(['ID REF', 'WALLET', 'USDC (PLAN)', 'USDC ENVIADO', 'HASH (REF)', 'TIMESTAMP', 'ESTADO']);

        // Add transaction data with COMPLETE values
        transactions.forEach(tx => {
            const sequentialId = tx.id - offset; // Numbering starts from 1 based on first result

            data.push([
                sequentialId,                                   // ID REF (preserves original numbering)
                tx.recipient_address || '',                     // WALLET (complete address)
                tx.amount ? parseFloat((parseFloat(tx.amount) / 1000000).toFixed(2)) : '',  // USDC (PLAN) - as number with 2 decimals
                tx.amount_sent ? parseFloat((parseFloat(tx.amount_sent) / 1000000).toFixed(2)) : (tx.amount ? parseFloat((parseFloat(tx.amount) / 1000000).toFixed(2)) : ''),  // USDC ENVIADO - as number with 2 decimals
                tx.tx_hash || '',                               // HASH (REF) (complete hash)
                tx.timestamp ? new Date(tx.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '', // TIMESTAMP
                tx.status || ''                                 // ESTADO
            ]);
        });

        // Create worksheet
        const ws = XLSX.utils.aoa_to_sheet(data);

        // Set column widths for better readability
        ws['!cols'] = [
            { wch: 8 },  // ID REF
            { wch: 45 }, // WALLET (full address)
            { wch: 20 }, // USDC (PLAN)
            { wch: 20 }, // USDC ENVIADO
            { wch: 70 }, // HASH (REF) (full hash)
            { wch: 22 }, // TIMESTAMP
            { wch: 18 }  // ESTADO
        ];

        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Transacciones');

        // Generate filename with batch ID and timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `batch_${batchId}_transacciones_${timestamp}.xlsx`;

        // Download file
        XLSX.writeFile(wb, filename);

        console.log(`✅ Excel exportado: ${filename} (${transactions.length} transacciones)`);

        // Restore button
        if (btn) btn.innerHTML = originalText;

    } catch (error) {
        console.error('Error al exportar a Excel:', error);
        alert('❌ Error al exportar a Excel: ' + error.message);

        // Restore button on error
        const btn = event?.target;
        if (btn && originalText) btn.innerHTML = originalText;
    }
}
