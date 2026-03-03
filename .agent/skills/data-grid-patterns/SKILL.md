---
name: data-grid-patterns
description: Patrones canónicos de grillas, filtros y paginación del proyecto spectral-celestial. Usar SIEMPRE que se necesite agregar una tabla de datos con filtros al panel principal. Garantiza coherencia visual con Transacciones e Instant Payment.
---

# Patrón Canónico de Grilla con Filtros

## Contexto

El proyecto tiene un design system dark glassmorphism con estas clases base en `public/style.css`:
- `.glass-panel` — panel principal (fondo azul oscuro, borde neon, border-radius 40px)
- `.ip-panel` — sub-panel interno (background transparente, border sutil)
- `.top-bar` — header de sección con `display:flex; justify-content:space-between; align-items:center`
- `.table-container` — wrapper de tabla (overflow-x:auto, border-radius:16px, bg rgba(0,0,0,0.2))
- `.input-glass` — inputs y selects del sistema
- `.btn-primary` — botón gradiente azul→violeta
- `.btn-glass` — botón transparente con blur
- `.badge` + `.badge-success/warning/danger/info` — píldoras de estado
- `.hidden` — `display: none !important`

## Estructura HTML de una Grilla Completa

```html
<!-- 1. Sección principal — siempre con class="glass-panel hidden" y un id único -->
<div id="miSeccionSection" class="glass-panel hidden">

    <!-- 2. Header de sección con top-bar -->
    <div class="top-bar">
        <div>
            <h2>📋 Título de la Sección</h2>
            <p style="margin:0; font-size:0.82rem; color:#94a3b8;">Subtítulo opcional</p>
        </div>
        <!-- Acciones del header (export, refresh, badge de rol) -->
        <div style="display:flex; gap:0.5rem; align-items:center;">
            <button class="btn btn-primary" onclick="miExportFn()"
                style="background:linear-gradient(135deg,#10b981,#059669);">
                📊 Exportar
            </button>
        </div>
    </div>

    <!-- 3. Barra de filtros: SIEMPRE flex, flex-wrap:nowrap, gap:0.5rem, overflow-x:auto -->
    <!-- Patrón de Instant Payment (recomendado): -->
    <div style="display:flex; flex-wrap:nowrap; align-items:center; gap:0.5rem;
                margin-bottom:1rem; overflow-x:auto; padding-bottom:2px;">

        <!-- filtros en este orden canónico: SELECT de estado → fechas → texto → número → botones -->
        <select id="miFilterStatus" class="input-glass" style="min-width:140px;">
            <option value="ALL">Todos los estados</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
        </select>

        <input id="miFilterDateFrom" type="date" class="input-glass" style="min-width:140px;">
        <input id="miFilterDateTo"   type="date" class="input-glass" style="min-width:140px;">

        <input id="miFilterWallet" type="text" class="input-glass"
               placeholder="Wallet..." style="min-width:180px; flex:1;">

        <!-- Checkbox inline (para filtros booleanos como "Solo errores") -->
        <label style="display:flex; align-items:center; gap:0.4rem; white-space:nowrap;
                      font-size:0.84rem; color:#94a3b8; cursor:pointer;">
            <input type="checkbox" id="miFilterOnlyErrors" style="accent-color:#ef4444;">
            Solo errores
        </label>

        <!-- Siempre estos dos botones al final -->
        <button class="btn btn-glass" onclick="miLoadData(1)" style="white-space:nowrap;">
            🔍 Filtrar
        </button>
        <button class="btn btn-glass" onclick="miClearFilters()" title="Limpiar filtros">✖</button>
    </div>

    <!-- 4. Tabla dentro de .table-container -->
    <div class="table-container">
        <table id="miTabla">
            <thead>
                <tr>
                    <!-- th sin estilos inline — usa los globales del CSS -->
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Wallet</th>
                    <th>Monto</th>
                    <th>Acción</th>
                </tr>
            </thead>
            <tbody id="miTablaBody">
                <tr>
                    <td colspan="5" style="text-align:center; opacity:0.6;">Cargando...</td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- 5. Paginación: SIEMPRE flex, justify-content:flex-end -->
    <div style="display:flex; justify-content:flex-end; align-items:center;
                margin-top:1rem; gap:0.5rem; color:#94a3b8; font-size:0.9rem;">
        <!-- contador de resultados alineado a la izquierda con margin-right:auto -->
        <span id="miCountLabel" style="margin-right:auto; font-size:0.8rem;"></span>
        <button class="btn-icon" id="miPrevPage"
            onclick="miLoadData(Math.max(1, miCurrentPage-1))">◀</button>
        <span id="miPageIndicator">Página 1 de 1</span>
        <button class="btn-icon" id="miNextPage"
            onclick="miLoadData(miCurrentPage+1)">▶</button>
    </div>

    <!-- 6. Panel de detalle expandible (opcional) — aparece debajo de la tabla -->
    <div id="miDetailPanel" class="hidden"
         style="margin-top:1.5rem; background:rgba(0,0,0,0.4);
                border:1px solid rgba(99,102,241,0.3); border-radius:10px; padding:1.25rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <h4 style="margin:0; color:#a5b4fc;">📄 Detalle</h4>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-glass" onclick="miCopyDetail()" style="font-size:0.8rem;">
                    📋 Copiar
                </button>
                <button class="btn btn-glass"
                    onclick="document.getElementById('miDetailPanel').classList.add('hidden')"
                    style="font-size:0.8rem;">✖ Cerrar</button>
            </div>
        </div>
        <!-- Contenido del panel -->
        <pre id="miDetailPre"
             style="background:rgba(0,0,0,0.3); padding:1rem; border-radius:6px;
                    font-size:0.78rem; color:#a5f3fc; overflow-x:auto; max-height:400px;
                    overflow-y:auto; margin:0; white-space:pre-wrap; word-break:break-all;">
        </pre>
    </div>

</div>
```

## Badges de Estado — Patrón Canónico JS

Siempre usar las clases de `style.css`, nunca `style` inline para colores de badge:

```javascript
function miStatusBadge(status) {
    const map = {
        confirmed: ['badge-success', 'Confirmed'],
        pending:   ['badge-info',    'Pending'],
        processing:['badge-warning', 'Processing'],
        failed:    ['badge-danger',  'Failed'],
    };
    const [cls, label] = map[status?.toLowerCase()] || ['badge-info', status || '—'];
    return `<span class="badge ${cls}">${label}</span>`;
}

// Para tipos de log (api_request vs webhook_sent):
function miLogTypeBadge(logType) {
    if (logType === 'api_request')
        return `<span class="badge badge-info">API Req</span>`;
    if (logType === 'webhook_sent')
        return `<span class="badge badge-warning">Webhook</span>`;
    return `<span class="badge">${logType}</span>`;
}

// Para HTTP status codes:
function miHttpBadge(status) {
    if (!status) return '—';
    const cls = status < 300 ? 'badge-success' : status < 400 ? 'badge-warning' : 'badge-danger';
    return `<span class="badge ${cls}">${status}</span>`;
}
```

## Patrón JS — Función de Carga de Grilla

```javascript
let miCurrentPage = 1;
let miTotalPages  = 1;

async function miLoadData(page) {
    miCurrentPage = Math.max(1, page || 1);

    // 1. Leer filtros
    const status   = document.getElementById('miFilterStatus')?.value || 'ALL';
    const dateFrom = document.getElementById('miFilterDateFrom')?.value || '';
    const dateTo   = document.getElementById('miFilterDateTo')?.value || '';
    const wallet   = document.getElementById('miFilterWallet')?.value || '';
    const onlyErrors = document.getElementById('miFilterOnlyErrors')?.checked;

    // 2. Construir params
    const params = new URLSearchParams({ page: miCurrentPage, limit: 50 });
    if (status && status !== 'ALL') params.append('status', status);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo)   params.append('date_to',   dateTo);
    if (wallet)   params.append('wallet',    wallet);
    if (onlyErrors) params.append('only_errors', 'true');

    // 3. Loading state (el colspan debe coincidir con el número de <th>)
    const tbody = document.getElementById('miTablaBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.6;">Cargando...</td></tr>`;

    try {
        const res  = await authenticatedFetch(`/api/v1/mi-endpoint?${params}`);
        const data = await res.json();

        // 4. Actualizar paginación
        miTotalPages = data.pagination?.totalPages || 1;
        document.getElementById('miPageIndicator').textContent =
            `Página ${miCurrentPage} de ${miTotalPages}`;
        document.getElementById('miCountLabel').textContent =
            `${data.pagination?.total || 0} registros`;
        document.getElementById('miPrevPage').disabled = miCurrentPage <= 1;
        document.getElementById('miNextPage').disabled = miCurrentPage >= miTotalPages;

        // 5. Renderizar filas
        if (!data.items?.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.6;">Sin resultados para los filtros aplicados.</td></tr>`;
            return;
        }
        tbody.innerHTML = data.items.map((item, i) => `
            <tr>
                <td style="font-size:0.8rem; color:#94a3b8; white-space:nowrap;">
                    ${new Date(item.created_at).toLocaleString()}
                </td>
                <td>${miStatusBadge(item.status)}</td>
                <td style="font-family:monospace; font-size:0.8rem;"
                    title="${item.wallet}">
                    ${item.wallet?.slice(0,6)}...${item.wallet?.slice(-4)}
                    <button class="btn-icon" onclick="copyToClipboard('${item.wallet}')"
                        title="Copiar">📋</button>
                </td>
                <td style="font-weight:600; color:#4ade80;">
                    $${parseFloat(item.amount || 0).toFixed(2)}
                </td>
                <td>
                    <button class="btn btn-glass" onclick="miShowDetail(${i})"
                        style="font-size:0.75rem; padding:0.25rem 0.6rem;">▶ Ver</button>
                </td>
            </tr>
        `).join('');
        window._miData = data.items; // store for detail viewer

    } catch(err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444;">Error: ${err.message}</td></tr>`;
    }
}

function miClearFilters() {
    ['miFilterStatus', 'miFilterDateFrom', 'miFilterDateTo', 'miFilterWallet'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = el.tagName === 'SELECT' ? el.options[0]?.value : '';
    });
    const cb = document.getElementById('miFilterOnlyErrors');
    if (cb) cb.checked = false;
    miLoadData(1);
}
```

## Patron JS — JSON Detail Viewer con Syntax Highlight

```javascript
function miShowDetail(idx) {
    const item  = window._miData?.[idx];
    if (!item) return;
    const panel = document.getElementById('miDetailPanel');
    const pre   = document.getElementById('miDetailPre');
    const json  = JSON.stringify(item, null, 2);
    // Syntax highlight sin dependencias externas
    pre.innerHTML = json
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"([^"]+)":/g,'<span style="color:#93c5fd;">"$1"</span>:')
        .replace(/: "([^"]*)"/g,': <span style="color:#86efac;">"$1"</span>')
        .replace(/: (\d+\.?\d*)/g,': <span style="color:#fde68a;">$1</span>')
        .replace(/: (true|false|null)/g,': <span style="color:#f9a8d4;">$1</span>');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
```

## Reglas de Coherencia Visual

1. **Nunca** usar `style` inline para colores de estado — siempre `class="badge badge-*"`
2. **Nunca** poner `margin-top` en `.table-container` — ya tiene el propio en el CSS global
3. La barra de filtros usa **`flex-wrap:nowrap`** con `overflow-x:auto` para no romper línea en desktop  
4. Wallets siempre truncadas: `${w.slice(0,6)}...${w.slice(-4)}` con botón 📋 copiar
5. Fechas: `new Date(x).toLocaleString()` — NUNCA format manual
6. El `colspan` del loading/empty state DEBE coincidir exactamente con el número de `<th>` en la tabla
7. Los `<th>` nunca llevan estilos inline de color/fondo — el CSS global ya los maneja
8. Campos `font-family:monospace` para: wallet, transfer_id, tx_hash, IP addresses
9. IP address: siempre mostrar como `font-family:monospace; font-size:0.78rem; color:#94a3b8;`

## Campos Nuevos: IP Address

Cuando se loguea la IP del cliente en el backend:

```javascript
// En Express — captura la IP correctamente detrás de Railway proxy
const clientIp = req.ip                          // usa trust proxy
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
```

En la tabla, la IP va en su propia columna (o dentro del JSON detail si la tabla ya está estrecha):

```html
<td style="font-family:monospace; font-size:0.78rem; color:#94a3b8;">${log.client_ip || '—'}</td>
```
