/**
 * Webhook Receiver de prueba — Spectral Celestial
 * Levanta un servidor en puerto 4001 que recibe, verifica y muestra los webhooks.
 *
 * Uso:
 *   1. Configurá tu WEBHOOK_SECRET en este script (o ponelo en .env)
 *   2. node _test_webhook_receiver.mjs
 *   3. En Connections Admin, configurá: http://localhost:4001/webhook
 *   4. Generá un transfer y observá los logs acá
 */

import http from 'http';
import crypto from 'crypto';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT = 4001;
const PATH = '/webhook';

// Ponés acá el secret que copiaste del modal de Connections Admin
// o lo leés del .env si lo compartís
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET_TEST || 'PEGA_TU_WHSEC_ACÁ';

// Rechazar requests con timestamp < 5 minutos de antigüedad (anti-replay)
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

// ─── COLORES ─────────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

function log(color, ...args) {
    console.log(color, ...args, C.reset);
}

// ─── SERVIDOR ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== PATH) {
        res.writeHead(404); res.end('Not found');
        return;
    }

    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', () => {
        const sig = req.headers['x-webhook-signature'] || '';
        const tsHeader = req.headers['x-webhook-timestamp'] || '';
        const now = Date.now();
        const ts = parseInt(tsHeader);

        console.log('\n' + '─'.repeat(60));
        log(C.bold + C.cyan, `📨 Webhook recibido: ${new Date().toLocaleString()}`);

        // 1. Anti-replay: verificar timestamp
        if (!tsHeader || isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_MS) {
            log(C.red, `❌ TIMESTAMP inválido o expirado: ${tsHeader} (drift: ${Math.abs(now - ts)}ms)`);
            res.writeHead(400); res.end(JSON.stringify({ error: 'Timestamp inválido' }));
            return;
        }
        log(C.dim, `   ⏱  Timestamp OK (drift: ${Math.abs(now - ts)}ms)`);

        // 2. Verificar firma HMAC-SHA256
        const expectedSig = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(tsHeader + rawBody)
            .digest('hex');

        if (sig === expectedSig) {
            log(C.green, `   ✅ Firma HMAC válida`);
        } else {
            log(C.red, `   ❌ Firma INVÁLIDA`);
            log(C.dim, `      Recibida:  ${sig}`);
            log(C.dim, `      Esperada:  ${expectedSig}`);
            res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid signature' }));
            return;
        }

        // 3. Parsear y mostrar payload
        try {
            const payload = JSON.parse(rawBody);
            log(C.yellow, `   📦 Event: ${payload.event}`);
            log(C.dim, `   🆔 TransferId:   ${payload.transferId}`);
            log(C.dim, `   👛 Funder:       ${payload.funder}`);
            log(C.dim, `   📬 Destino:      ${payload.to}`);
            log(C.dim, `   💰 Amount:       ${payload.amount} USDC`);
            log(C.dim, `   📊 Status:       ${payload.status}`);
            log(C.dim, `   💳 Restante:     ${payload.remaining_allowance ?? '—'} USDC`);
            log(C.dim, `   📅 Vence:        ${payload.policy_expires_at ?? '—'}`);
            if (payload.tx_hash) log(C.dim, `   🔗 TxHash:       ${payload.tx_hash}`);
            console.log('\n   Full payload:');
            console.dir(payload, { depth: null, colors: true });
        } catch (_) {
            log(C.yellow, `   ⚠️  Payload no es JSON válido: ${rawBody.slice(0, 200)}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
    });
});

server.listen(PORT, () => {
    console.log('\n' + '═'.repeat(60));
    log(C.bold + C.green, `🚀 Webhook Receiver corriendo en http://localhost:${PORT}${PATH}`);
    console.log(`   Secret configurado: ${WEBHOOK_SECRET === 'PEGA_TU_WHSEC_ACÁ' ? '⚠️  SIN CONFIGURAR' : '✅ ' + WEBHOOK_SECRET.slice(0, 12) + '...'}`);
    console.log(`   En Connections Admin, configurá URL: http://localhost:${PORT}${PATH}`);
    console.log('═'.repeat(60) + '\n');
});
