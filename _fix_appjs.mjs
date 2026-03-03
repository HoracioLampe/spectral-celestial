import { readFileSync, writeFileSync } from 'fs';
const file = 'public/app.js';
let src = readFileSync(file, 'utf8');

// 1. Add }; to close ipLoadLogs after its catch block
const OLD_CATCH = `    } catch (err) {
        if (tbody) tbody.innerHTML = \`<tr><td colspan="10" style="text-align:center; color:#ef4444;">Error: \${err.message}</td></tr>\`;
        console.error('[IP Logs] error:', err);
    }`;
const NEW_CATCH = OLD_CATCH + '\n};';

if (!src.includes(OLD_CATCH)) {
    console.error('catch pattern not found'); process.exit(1);
}
src = src.replace(OLD_CATCH, NEW_CATCH);

// 2. In the row template: split date into two lines
// Replace: new Date(log.created_at).toLocaleString()
// With: date on first line, time on second
src = src.replace(
    `const date = log.created_at ? new Date(log.created_at).toLocaleString() : '—';`,
    `const dt = log.created_at ? new Date(log.created_at) : null;
            const date = dt ? dt.toLocaleDateString() : '—';
            const time = dt ? '<br><span style="font-size:0.7rem;opacity:0.7;">' + dt.toLocaleTimeString() + '</span>' : '';`
);

// 3. Update date cell to use date+time
src = src.replace(
    `<td style="font-size:0.75rem; color:#94a3b8; white-space:nowrap;">\${date}</td>`,
    `<td style="font-size:0.75rem; color:#94a3b8; white-space:nowrap; line-height:1.2;">\${date}\${time}</td>`
);

// 4. Shorten event type: replace full name with abbreviated badge
// "transfer.received" → "rcvd" etc., max 2 lines
src = src.replace(
    `const evType = log.event_type || '—';`,
    `const rawEvType = log.event_type || '—';
            const evType = rawEvType
                .replace('transfer.received', 'tr.<br>rcvd')
                .replace('transfer.confirmed', 'tr.<br>conf')
                .replace('transfer.failed', 'tr.<br>fail')
                .replace('webhook_sent', 'wh.<br>sent')
                .replace('api_request', 'api<br>req');`
);

writeFileSync(file, src, 'utf8');
console.log('Done ✅');
