console.log('[Recovery] Script loaded, waiting for DOM...');

document.addEventListener('DOMContentLoaded', () => {
    console.log('[Recovery] DOM loaded, starting batch load...');
    loadRecoveryBatches();
});

async function loadRecoveryBatches() {
    console.log('[Recovery] loadRecoveryBatches() called');
    const container = document.getElementById('recoveryStats');
    console.log('[Recovery] Container element:', container);

    const token = localStorage.getItem('token');
    console.log('[Recovery] Token exists:', !!token);

    if (!token) {
        console.warn('[Recovery] No token found, redirecting to login');
        window.location.href = '/';
        return;
    }

    try {
        console.log('[Recovery] Fetching batches from API...');
        const response = await fetch('/api/recovery/batches', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('[Recovery] Response status:', response.status);
        console.log('[Recovery] Response ok:', response.ok);

        if (response.status === 401 || response.status === 403) {
            console.warn('[Recovery] Unauthorized, clearing token and redirecting');
            localStorage.removeItem('token');
            window.location.href = '/';
            return;
        }

        if (!response.ok) {
            console.error('[Recovery] Response not OK, throwing error');
            throw new Error('Error al cargar datos');
        }

        const batches = await response.json();
        console.log('[Recovery] Batches received:', batches);
        console.log('[Recovery] Batches count:', batches.length);

        if (batches.length === 0) {
            console.log('[Recovery] No batches found, showing empty state');
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 4rem; opacity: 0.6;">
                    <p style="font-size: 1.5rem; margin-bottom: 0.5rem;">🎉 Todo está limpio</p>
                    <p>No se encontraron lotes con saldos pendientes de recuperar.</p>
                </div>
            `;
            return;
        }

        console.log('[Recovery] Rendering batch grid...');

        container.innerHTML = batches.map(batch => `
            <div class="batch-card" id="batch-${batch.id}">
                <div class="batch-header">
                    <span class="batch-id">Lote #${batch.id}</span>
                    <span class="batch-status status-${batch.batch_status.toLowerCase()}">${batch.batch_status}</span>
                </div>
                
                <div class="batch-stats">
                    <div class="stat-item">
                        <span class="stat-label">Relayers Totales</span>
                        <span class="stat-value">${batch.total_relayers}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Saldo Recuperable</span>
                        <span class="stat-value" style="color: #f1c40f;">${parseFloat(batch.total_pol).toFixed(4)} POL</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Transacciones</span>
                        <span class="stat-value">${batch.total_transactions}</span>
                    </div>
                </div>

                <div class="funder-info">
                    Funder: ${batch.funder_address ? (batch.funder_address.substring(0, 10) + '...' + batch.funder_address.substring(38)) : 'Desconocido'}
                </div>

                <div class="recovery-actions">
                    <button class="btn-recover" onclick="recoverFunds(${batch.id})">
                        <span>💰</span> Recuperar Fondos
                    </button>
                </div>
            </div>
        `).join('');

        console.log('[Recovery] Grid rendered successfully');

    } catch (err) {
        console.error('[Recovery] Error loading batches:', err);
        console.error('[Recovery] Error name:', err.name);
        console.error('[Recovery] Error message:', err.message);
        console.error('[Recovery] Error stack:', err.stack);
        container.innerHTML = `<p style="color: #e74c3c; text-align: center; padding: 2rem;">Error: ${err.message}</p>`;
    }
}

async function recoverFunds(batchId) {
    const btn = document.querySelector(`#batch-${batchId} .btn-recover`);
    const card = document.getElementById(`batch-${batchId}`);

    if (!confirm(`¿Estás seguro de que deseas recuperar los fondos del Lote #${batchId}? Se verificará si hay relayers bloqueados y se desbloquearán.`)) return;

    try {
        btn.disabled = true;
        btn.innerHTML = `<div class="loading-spinner"></div> Procesando...`;

        const token = localStorage.getItem('token');
        const response = await fetch(`/api/batches/${batchId}/return-funds`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (response.ok) {
            alert(`✅ ${result.message}`);
            card.style.opacity = '0.5';
            btn.innerHTML = '✅ Completado';
            // Reload after a short delay
            setTimeout(loadRecoveryBatches, 2000);
        } else {
            throw new Error(result.error || 'Error en la recuperación');
        }

    } catch (err) {
        alert(`❌ Error: ${err.message}`);
        btn.disabled = false;
        btn.innerHTML = `<span>💰</span> Reintentar Recuperación`;
    }
}
