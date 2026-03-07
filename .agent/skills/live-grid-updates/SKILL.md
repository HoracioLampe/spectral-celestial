---
name: live-grid-updates
description: Patrón canónico para actualizar grillas de datos en tiempo real via SSE sin flicker. Usar cuando se necesite que una tabla (IP Logs, Transacciones, etc.) se actualice automáticamente al recibir nuevos datos del backend.
---

# Live Grid Updates via SSE

## El problema

Las grillas de datos (tablas paginadas) en el panel tienen este problema clásico:

> El usuario ve datos estáticos — tiene que recargar la página para ver cambios recientes.

La solución **incorrecta** es un `setInterval` que recarga toda la tabla cada N segundos:
- Feo: muestra "Cargando..." constantemente
- Costoso: hace requests aunque no haya nada nuevo
- Incómodo: interrumpe mientras el usuario interactúa

## La solución canónica: SSE + silent refresh

### Arquitectura

```
Backend evento (INSERT en DB)
    └── emite SSE con tipo específico (ej: ip_log.new)
          └── sseAdminClients (SUPER_ADMIN conectados)
                └── frontend: onmessage → loadGrid(silent=true)
```

### Paso 1: Backend — emitir evento SSE tras el INSERT

Inmediatamente después del INSERT que genera el nuevo dato, emitís el evento SSE.

**Ejemplo en endpoint Express:**
```js
pool.query('INSERT INTO mi_tabla ...', [...]).then(() => {
    const payload = JSON.stringify({ type: 'mi_tabla.new', ts: Date.now() });
    sseAdminClients.forEach(r => {
        try { r.write(`data: ${payload}\n\n`); } catch (_) {}
    });
}).catch(console.warn);
```

**Ejemplo en un servicio separado (Engine/Worker):**
```js
// El constructor recibe notifyInstantEvent inyectado desde server.js
this._notify = typeof notifyInstantEvent === 'function' ? notifyInstantEvent : () => {};

// Después del INSERT:
this.pool.query('INSERT INTO mi_tabla ...', [...]).then(() => {
    this._notify(coldWallet, 'mi_tabla.new', { event: eventType });
}).catch(console.warn);
```

> ⚠️ `this._notify` = `notifyInstantEvent` de server.js, que broadcast a `sseAdminClients`.

### Paso 2: Backend — SUPER_ADMIN en sseAdminClients

En el endpoint SSE (`GET /api/v1/instant/events`), registrá al SUPER_ADMIN en el set de admin:

```js
const isAdmin = req.user?.role === 'SUPER_ADMIN';
if (isAdmin) sseAdminClients.add(res);

req.on('close', () => {
    // ...cleanup sseClients...
    if (isAdmin) sseAdminClients.delete(res);
});
```

### Paso 3: Frontend — función de carga con parámetro `silent`

Modificá la función de carga de la grilla para aceptar `silent = false`:

```js
async function loadMiGrilla(page, silent = false) {
    const tbody = document.getElementById('miTablaBody');

    if (!silent) {
        // Carga normal: muestra spinner
        tbody.innerHTML = '<tr><td colspan="X">Cargando...</td></tr>';
    } else {
        // Carga silenciosa: fade suave
        tbody.style.transition = 'opacity 0.2s ease';
        tbody.style.opacity = '0.4';
    }

    try {
        const res = await authenticatedFetch(`/api/v1/mi-endpoint?page=${page}`);
        const data = await res.json();
        tbody.innerHTML = data.rows.map(row => renderRow(row)).join('');
        // Restaurar opacidad con requestAnimationFrame para el fade-in
        if (silent) requestAnimationFrame(() => { tbody.style.opacity = '1'; });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="X">Error: ${err.message}</td></tr>`;
        tbody.style.opacity = '1';
    }
}
```

### Paso 4: Frontend — conectar SSE y manejar el evento

En la función que muestra la sección, conectá al SSE (no lo desconectes):

```js
function showMiSeccion() {
    ipConnectSSE(); // mantener SSE activo
    showSection('miSeccion', 'navMiSeccion', () => loadMiGrilla(1));
}
```

En el handler del SSE `onmessage`, reconocé tu evento:

```js
ipEventSource.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'heartbeat') return;

    // Tu evento específico
    if (ev.type === 'mi_tabla.new') {
        const section = document.getElementById('miSeccion');
        if (section && section.style.display !== 'none') {
            loadMiGrilla(1, true); // silent refresh
        }
        return;
    }

    // Otros handlers existentes (transfer.received, etc.)
};
```

## Reglas de oro

| ✅ Hacer | ❌ No hacer |
|---------|------------|
| Emitir SSE *después* del INSERT (`.then()`) | Polling con `setInterval` |
| Usar `requestAnimationFrame` para el fade-in | Usar `setTimeout` para la transición |
| Verificar que la sección esté visible antes de recargar | Recargar aunque el usuario esté en otra sección |
| Pasar `silent=true` al actualizar desde SSE | Llamar `loadGrid()` sin silencio (causa flicker) |
| Desregistrar el cliente SSE en `req.on('close')` | Dejar clientes zombie en `sseAdminClients` |

## Notas de implementación

- `sseAdminClients` es un `Set<res>` global en `server.js` — shared entre todos los endpoints
- El SSE endpoint está en `GET /api/v1/instant/events` — SUPER_ADMIN se agrega automáticamente
- El heartbeat (25s interval) mantiene la conexión viva a través de proxies (Railway/Nginx)
- SSE auto-reconecta cada 5s en caso de error de red (`onerror` handler)
