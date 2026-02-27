---
name: timezone-date-display
description: Timezone-aware date and time display. Dates are always stored in UTC in the database and displayed in the timezone configured in the user's profile (user.tenant.timezone). Use when displaying dates, times, date fields, timestamps, created_at, issued_at, updated_at, blockchain_minted_at, or any date-related field in the UI.
keywords: [timezone, time zone, fecha, fechas, campo de fecha, date field, timestamp, created_at, issued_at, updated_at, blockchain_minted_at, formatDate, useDateFormat, toLocaleDateString, toLocaleTimeString, UTC, hora local, perfil usuario, user profile]
---

# Timezone Date Display Skill

## Core Principle

> **Dates are ALWAYS stored in UTC in the database. They are displayed in the timezone configured in the user's profile.**

- **Storage**: PostgreSQL `NOW()` is always UTC. Node.js `new Date().toISOString()` is always UTC. Never store timezone-adjusted dates.
- **Display**: Use `user.tenant.timezone` (IANA string, e.g. `America/Argentina/Buenos_Aires`). This is set by the user in **Settings → Organización → Timezone** and saved to `tenants.timezone` in the DB.

---

## ⚠️ CRITICAL: Fix the `pg` Driver Timezone Auto-Conversion

**This is the most important step and must be done first.**

By default, the Node.js `pg` driver **automatically converts** `TIMESTAMPTZ` fields from UTC to the local timezone of the Node process before returning them. This causes a **double-conversion bug**:

1. `pg` converts `18:44:39 UTC` → `15:44:39` (Argentina local)
2. `useDateFormat` converts `15:44:39` (treated as UTC) → `12:44:39` (Argentina again) ❌

### Fix: `backend/config/database.js`

Add `types.setTypeParser` **before** creating the Pool:

```js
import pg from 'pg';
const { Pool, types } = pg;

// CRITICAL: Prevent pg driver from auto-converting TIMESTAMPTZ to local timezone.
// By default, pg converts timestamps to the Node process local time before returning them.
// This causes double-conversion: pg converts UTC→local, then useDateFormat converts again.
// Solution: return raw UTC strings and let the frontend handle timezone display.
// OID 1114 = TIMESTAMP, OID 1184 = TIMESTAMPTZ
types.setTypeParser(1114, (val) => val ? val + 'Z' : null);  // TIMESTAMP → treat as UTC
types.setTypeParser(1184, (val) => val ? new Date(val).toISOString() : null); // TIMESTAMPTZ → UTC ISO string

const pool = new Pool(dbConfig);
```

After this fix, all timestamps arrive at the frontend as clean UTC ISO strings (e.g. `2026-02-18T18:44:39.214Z`), and `useDateFormat` converts them correctly to the user's timezone.

---

## The Hook: `useDateFormat`

Located at `src/hooks/useDateFormat.js`. Reads `user.tenant.timezone` from `AuthContext`.

### Import and Usage

```jsx
import { useDateFormat } from '@/hooks/useDateFormat';

// Inside your component:
const { formatDate, getCurrentTime, getTimezoneOffset } = useDateFormat();
```

### `formatDate(dateValue, format)`

Formats any UTC date value (ISO string, Date object, timestamp) in the **user's profile timezone**.

| Format | Output example (America/Argentina/Buenos_Aires) |
|--------|------------------------------------------------|
| `'short'` | `18/02/2026` |
| `'medium'` | `18/02/2026, 16:44` |
| `'full'` | `18/02/2026, 16:44:30` |
| `'time'` | `16:44:30` |

```jsx
// In a table cell:
<span>{formatDate(cert.issued_at, 'short')}</span>
<span>{formatDate(cert.created_at, 'medium')}</span>

// Time only:
<span>{formatDate(lastUpdated, 'time')}</span>
```

### `getTimezoneOffset()`

Returns a string like `UTC-03:00` based on the **user's profile timezone**. Use it as a badge next to date column headers so users know which timezone is active.

```jsx
<th>
  Fecha / Hora
  <span className="ml-1 px-1.5 py-0.5 bg-blue-50 text-blue-500 rounded font-mono text-[10px] border border-blue-100">
    {getTimezoneOffset()}
  </span>
</th>
```

### `getCurrentTime()`

Returns the current time in the user's profile timezone.

```jsx
<span>Actualizado: {getCurrentTime()}</span>
```

---

## Replacing Legacy Date Formatting

When you find any of these patterns, replace them:

```jsx
// ❌ BEFORE — ignores user's timezone preference
new Date(cert.issued_at).toLocaleDateString()
new Date(cert.issued_at).toLocaleTimeString()
new Date(event.timestamp).toISOString().replace('T', ' ').substring(0, 19)

// ✅ AFTER — uses user's profile timezone
formatDate(cert.issued_at, 'short')
formatDate(cert.issued_at, 'time')
formatDate(event.timestamp, 'full')
```

Also remove any local `formatDate` function that uses `toLocaleDateString('es-ES', {...})` — replace with the hook.

---

## Where Timezone is Configured

| Layer | Detail |
|-------|--------|
| **User-facing setting** | Settings → Organización → Timezone (dropdown with IANA timezones) |
| **Stored in DB** | `tenants.timezone` column (IANA string, e.g. `America/Argentina/Buenos_Aires`) |
| **Read by hook** | `user?.tenant?.timezone` via `AuthContext` → defaults to `'UTC'` if not set |
| **Sent by backend** | `auth.js` login/me endpoints include `tenant: { timezone: user.tenant_timezone }` |

---

## Date Filter Conversion (Desde / Hasta)

When a user selects a date in a `<input type="date">` filter, the browser gives a `YYYY-MM-DD` string in the **user's local display timezone**. The certificates in the DB have UTC timestamps. You must convert the selected date to UTC bounds before filtering.

### Pattern: `toUTCBounds` helper (client-side filter)

```js
// Inside useMemo filter block — needs access to `user` from useAuth()
const toUTCBounds = (dateStr, isEnd = false) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const tz = user?.tenant?.timezone || 'UTC';
  // Use Intl to get the UTC offset for that timezone (noon to avoid DST edge cases)
  const formatter = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
  const parts = formatter.formatToParts(new Date(`${dateStr}T12:00:00Z`));
  const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
  const raw = offsetStr.replace('GMT', '') || '+0';
  const sign = raw[0] === '-' ? -1 : 1;
  const [h, m = '0'] = raw.replace(/^[+-]/, '').split(':');
  const offsetMinutes = sign * (parseInt(h) * 60 + parseInt(m));
  // Start of day in tenant tz = UTC midnight minus offset
  if (!isEnd) return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMinutes * 60000);
  // End of day = 23:59:59.999 local
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMinutes * 60000);
};

// Usage:
if (filters.dateFrom) {
  const fromUTC = toUTCBounds(filters.dateFrom, false);
  filtered = filtered.filter(cert => new Date(cert.created_at) >= fromUTC);
}
if (filters.dateTo) {
  const toUTC = toUTCBounds(filters.dateTo, true);
  filtered = filtered.filter(cert => new Date(cert.created_at) <= toUTC);
}
```

**Why**: `new Date('2026-02-18')` in the browser creates `2026-02-18T00:00:00 UTC` (midnight UTC), not midnight Argentina. For a user in UTC-3, this would exclude certificates from `2026-02-17T21:00:00 UTC` to `2026-02-18T00:00:00 UTC` that should be included.

---

## Backend Rules


1. **Always insert/update dates as UTC** — use `NOW()` in PostgreSQL or `new Date().toISOString()` in Node.js
2. **Never store timezone-adjusted dates** in the DB
3. **Fix the `pg` driver** with `types.setTypeParser` (see above — this is mandatory)
4. **Serialize dates as ISO strings** before sending via API or GraphQL:

```js
// In resolvers.js and relayerQueueService.js PubSub publish:
cert.issued_at = cert.issued_at ? new Date(cert.issued_at).toISOString() : null;
cert.blockchain_minted_at = cert.blockchain_minted_at ? new Date(cert.blockchain_minted_at).toISOString() : null;
```

5. **GraphQL schema**: date fields must be `String` type (ISO 8601 strings)

---

## Troubleshooting

### Dates show 3 hours off (e.g. `15:44` instead of `18:44`)

**Root cause**: The `pg` driver is auto-converting timestamps to the Node process local timezone before returning them. The frontend then converts again, resulting in double subtraction.

**Fix**: Add `types.setTypeParser` to `backend/config/database.js` as shown above. Restart the server after the fix.

**How to diagnose**: Run this Node script:
```js
import { query } from './backend/config/database.js';
const r = await query("SELECT NOW() as utc, NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires' as arg");
console.log(r.rows[0]);
// If utc === arg → pg driver is NOT converting (correct after fix)
// If arg is 3h ahead of utc → pg driver IS converting (bug present)
```

### Badge shows wrong UTC offset (e.g. `UTC-01:00` instead of `UTC-03:00`)

Two possible causes:

1. **`getTimezoneOffset()` bug** — The old implementation used `toLocaleString` diff which is unreliable. The correct implementation uses `Intl.DateTimeFormat` with `timeZoneName: 'shortOffset'`:

```js
const getTimezoneOffset = () => {
    try {
        const formatter = new Intl.DateTimeFormat('en', {
            timeZone: tenantTimezone,
            timeZoneName: 'shortOffset'
        });
        const parts = formatter.formatToParts(new Date());
        const offsetPart = parts.find(p => p.type === 'timeZoneName');
        if (offsetPart) {
            const raw = offsetPart.value.replace('GMT', '');
            if (!raw || raw === '+0' || raw === '-0') return 'UTC+00:00';
            const sign = raw[0];
            const rest = raw.slice(1);
            const [h, m = '0'] = rest.split(':');
            return `UTC${sign}${String(parseInt(h)).padStart(2, '0')}:${String(parseInt(m)).padStart(2, '0')}`;
        }
        return tenantTimezone;
    } catch (error) {
        return 'UTC';
    }
};
```

2. **Stale user object in localStorage** — The `user.tenant.timezone` is cached at login time. If the timezone was changed in Settings after login, the cached value is outdated. **Fix: logout → login** to refresh the user object from the DB.

### After fix, rebuild and restart

After any change to `database.js` or `useDateFormat.js`:
```bash
npm run build   # rebuild frontend
# then restart the Node server (Ctrl+C + node backend/server.js)
# then hard-refresh the browser (Ctrl+Shift+R)
```
