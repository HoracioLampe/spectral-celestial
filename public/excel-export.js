// Excel Export Function for Transaction Grid
function exportToExcel() {
    try {
        const tbody = document.getElementById('batchTableBody');

        if (!tbody || tbody.rows.length === 0) {
            alert('⚠️ No hay datos para exportar');
            return;
        }

        // Prepare data array for Excel
        const data = [];

        // Add header row
        data.push(['ID REF', 'WALLET', 'USDC (PLAN)', 'USDC ENVIADO', 'HASH (REF)', 'TIMESTAMP', 'ESTADO']);

        // Extract data from visible table rows
        for (let i = 0; i < tbody.rows.length; i++) {
            const row = tbody.rows[i];
            const cells = row.cells;

            // Skip if it's an empty/placeholder row
            if (cells.length < 6) continue;

            const rowData = [
                cells[0].textContent.trim(), // ID REF
                cells[1].textContent.trim(), // WALLET
                cells[2].textContent.trim(), // USDC (PLAN)
                cells[3].textContent.trim(), // USDC ENVIADO
                cells[4].textContent.trim(), // HASH (REF)
                new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }), // TIMESTAMP
                cells[5].textContent.trim()  // ESTADO
            ];

            data.push(rowData);
        }

        // Create worksheet
        const ws = XLSX.utils.aoa_to_sheet(data);

        // Set column widths
        ws['!cols'] = [
            { wch: 8 },  // ID REF
            { wch: 45 }, // WALLET
            { wch: 15 }, // USDC (PLAN)
            { wch: 15 }, // USDC ENVIADO
            { wch: 20 }, // HASH (REF)
            { wch: 20 }, // TIMESTAMP
            { wch: 15 }  // ESTADO
        ];

        // Create workbook
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Transacciones');

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `transacciones_${timestamp}.xlsx`;

        // Download file
        XLSX.writeFile(wb, filename);

        console.log(`✅ Excel exportado: ${filename}`);
    } catch (error) {
        console.error('Error al exportar a Excel:', error);
        alert('❌ Error al exportar a Excel: ' + error.message);
    }
}
