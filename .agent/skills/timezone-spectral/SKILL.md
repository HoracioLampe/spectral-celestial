---
name: timezone-spectral
description: >
  Patrón canónico de timezone para spectral-celestial (vanilla JS + Express).
  USER_TIMEZONE se carga de la DB por cold-wallet. Usar SIEMPRE que se muestren
  fechas, horas, filtros de fecha, inputs datetime-local o exports de Excel.
  NO usar toLocaleDateString/toLocaleTimeString/toLocaleString sin timezone.
keywords: [timezone, fecha, hora, date, time, formatDateTZ, USER_TIMEZONE, excel, export, datetime-local, filtro, ip logs, instant payment, batches]
---

# Timezone en Spectral-Celestial

## Principio Core

> **Las fechas se almacenan en UTC en Postgres. Se muestran en el timezone
> configurado por el usuario (`USER_TIMEZONE`), guardado en `rbac_users.timezone`.**

---

## Variables y Funciones Globales (definidas en `public/app.js`)

```js
// Global — se setea al login/session-restore via ipLoadTimezone()
let USER_TIMEZONE = 'America/Argentina/Buenos_Aires'; // default

// Formatea cualquier fecha UTC → string en USER_TIMEZONE
// format: 'short' (solo fecha) | 'time' (solo hora) | default (fecha + hora)
function formatDateTZ(dateStr, format) { ... }      // retorna string "dd/mm/aaaa, HH:mm:ss"

// Retorna label del offset, e.g. "UTC-03:00"
function getTZOffsetLabel() { ... }

// Convierte YYYY-MM-DD (de date input) a ISO UTC para filtros de API
// isEnd=true → fin del día (23:59:59.999), false → inicio (00:00:00)
function toUTCBounds(dateStr, isEnd) { ... }
```

---

## Regla: NUNCA usar estas formas sin timezone

```js
// ❌ MAL — usa timezone del browser, no del usuario
new Date(x).toLocaleDateString()
new Date(x).toLocaleTimeString()
new Date(x).toLocaleString()

// ✅ BIEN — siempre con USER_TIMEZONE
formatDateTZ(x)              // fecha + hora: "18/02/2026, 16:44:30"
formatDateTZ(x, 'short')     // solo fecha:   "18/02/2026"
formatDateTZ(x, 'time')      // solo hora:    "16:44:30"
```

---

## Patterns por Caso de Uso

### 1. Columna de fecha en una tabla (grilla)

```js
// En la generación de innerHTML de un tbody
const dateFull = log.created_at ? formatDateTZ(log.created_at) : null;
const [datePart, timePart] = dateFull ? dateFull.split(', ') : ['—', ''];
const dateCell = dateFull
    ? `<span style="font-size:0.75rem;color:#94a3b8;">${datePart}</span><br>
       <span style="font-size:0.7rem;color:#64748b;">${timePart}</span>`
    : '—';
```

### 2. Badge de offset en header de columna

```html
<!-- En el <th> de fecha -->
<th>Fecha / Hora <span id="ipTimezoneBadge" style="font-size:0.7rem;color:#60a5fa;"></span></th>
```
```js
// Setear el badge al cargar:
document.getElementById('ipTimezoneBadge').textContent = getTZOffsetLabel();
```

### 3. Filtros de fecha (date inputs → API params)

```js
// SIEMPRE convertir con toUTCBounds antes de enviar al backend
const dateFrom = document.getElementById('myDateFrom')?.value || '';
const dateTo   = document.getElementById('myDateTo')?.value   || '';
const params = new URLSearchParams();
if (dateFrom) params.append('date_from', toUTCBounds(dateFrom, false));
if (dateTo)   params.append('date_to',   toUTCBounds(dateTo, true));
```

### 4. Input `datetime-local` — pre-fill con USER_TIMEZONE

```js
// ❌ MAL — usa timezone del browser
const local = new Date(Date.now() - offset).toISOString().slice(0, 16);

// ✅ BIEN — usa USER_TIMEZONE
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
const tz = USER_TIMEZONE || 'UTC';
const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
}).formatToParts(future);
const get = (type) => parts.find(p => p.type === type)?.value || '00';
document.getElementById('myDatetimeInput').value =
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
```

### 5. Convertir datetime-local → Unix timestamp (respetando USER_TIMEZONE)

```js
// El usuario ingresó la hora en USER_TIMEZONE, new Date(expiry) la interpreta
// como hora del browser → error si difieren. Usar el offset correcto:
const tz = USER_TIMEZONE || 'UTC';
const [datePart, timePart] = expiry.split('T');
const [year, month, day]   = datePart.split('-').map(Number);
const [hour, minute]       = timePart.split(':').map(Number);
const offsetParts = new Intl.DateTimeFormat('en', {
    timeZone: tz, timeZoneName: 'shortOffset'
}).formatToParts(new Date(`${datePart}T12:00:00Z`));
const offsetStr = (offsetParts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0').replace('GMT', '');
const sign = (offsetStr[0] === '-') ? -1 : 1;
const [h, m = '0'] = offsetStr.replace(/^[+-]/, '').split(':');
const offsetMs = sign * (parseInt(h) * 60 + parseInt(m)) * 60000;
const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offsetMs;
const deadlineUnix = Math.floor(utcMs / 1000);
```

### 6. Excel export — client-side (Batch export)

```js
// En el array de datos para XLSX:
tx.timestamp ? formatDateTZ(tx.timestamp) : ''
```

### 7. Excel export — server-side (IP Transfers export)

```js
// Frontend: pasar USER_TIMEZONE como param tz + filtros con toUTCBounds
params.append('tz', USER_TIMEZONE || 'UTC');
if (dateFrom) params.append('date_from', toUTCBounds(dateFrom, false));
if (dateTo)   params.append('date_to',   toUTCBounds(dateTo, true));

// Backend server.js: recibir tz y usarlo con toLocaleString
const { tz } = req.query;
const userTz = (tz && tz.length < 60) ? tz : 'UTC';
const fmtDate = (d) => {
    if (!d) return '';
    try { return new Date(d).toLocaleString('es-AR', { timeZone: userTz, hour12: false }); }
    catch { return new Date(d).toISOString(); }
};
// Usar fmtDate(r.created_at) en el sheet
```

---

## Cómo se carga USER_TIMEZONE al login

```js
// En session restore y en login exitoso — llama a ipLoadTimezone()
// ipLoadTimezone() = loadUserTimezone() (son aliases)
async function ipLoadTimezone() {
    const r = await authenticatedFetch('/api/v1/user/settings');
    if (r?.ok) {
        const d = await r.json();
        if (d.timezone) {
            USER_TIMEZONE = d.timezone;
            const sel = document.getElementById('ipTimezoneSelect');
            if (sel) sel.value = d.timezone;        // pre-carga el dropdown
            const badge = document.getElementById('ipTimezoneBadge');
            if (badge) badge.textContent = getTZOffsetLabel(); // actualiza badge
        }
    }
}
```

### Al abrir Connections Admin (navConnections)

```js
// En showConnectionsAdminSection() — siempre llamar
function showConnectionsAdminSection() {
    showSection('connectionsAdminSection', 'navConnections', () => {
        ipLoadApiKey();
        ipLoadWebhook();
        ipLoadTimezone(); // ← pre-popula el select del dropdown desde DB
    });
}
```

---

## Backend — endpoints relacionados

```
GET /api/v1/user/settings        → { timezone: 'America/Argentina/Buenos_Aires' }
PUT /api/v1/user/settings        → body: { timezone: 'America/New_York' }
GET /api/v1/instant/transfers/export?tz=America/Argentina/Buenos_Aires&...
```

### Validación en server.js

```js
const VALID_TIMEZONES = ['UTC', 'America/Argentina/Buenos_Aires', 'America/New_York', ...];
if (!VALID_TIMEZONES.includes(timezone)) return res.status(400).json({ error: 'Invalid timezone' });
```

### Filtros de fecha en queries SQL

```sql
-- SIEMPRE usar ::timestamptz, NUNCA ::date (falla con ISO strings con tiempo)
WHERE created_at >= $1::timestamptz
  AND created_at <= $2::timestamptz
```

---

## Checklist al agregar una nueva grilla o panel

- [ ] Fechas usan `formatDateTZ(x)` o `formatDateTZ(x, 'short')`
- [ ] Header de columna tiene badge `getTZOffsetLabel()`
- [ ] Filtros de fecha usan `toUTCBounds(dateStr, isEnd)`
- [ ] Si hay `datetime-local`: pre-fill con `Intl.DateTimeFormat` + `USER_TIMEZONE`
- [ ] Si hay `datetime-local`: conversión a Unix usa offset de `USER_TIMEZONE`
- [ ] Export Excel pasa `tz=USER_TIMEZONE` al servidor o usa `formatDateTZ` client-side
- [ ] Backend filters usan `::timestamptz` no `::date`
