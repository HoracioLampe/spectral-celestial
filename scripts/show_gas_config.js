require('dotenv').config();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║           ⚙️  GAS CONFIGURATION VARIABLES                  ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log(`║ GAS_BUFFER_PERCENT:     ${(process.env.GAS_BUFFER_PERCENT || '15 (default)').padEnd(32)} ║`);
console.log(`║ GAS_CUSHION_MATIC:      ${(process.env.GAS_CUSHION_MATIC || '0.02 (default)').padEnd(32)} ║`);
console.log('╠════════════════════════════════════════════════════════════╣');
console.log(`║ RPC_URL:                ${(process.env.RPC_URL ? 'Set ✓' : 'Not Set ✗').padEnd(32)} ║`);
console.log(`║ RPC_FALLBACK_URL:       ${(process.env.RPC_FALLBACK_URL ? 'Set ✓' : 'Not Set ✗').padEnd(32)} ║`);
console.log('╠════════════════════════════════════════════════════════════╣');
console.log(`║ SESSION_TIMEOUT_MINUTES: ${(process.env.SESSION_TIMEOUT_MINUTES || '120 (default)').padEnd(31)} ║`);
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('\n');

// Calculate example costs
const bufferPercent = parseInt(process.env.GAS_BUFFER_PERCENT || 15);
const cushionMatic = parseFloat(process.env.GAS_CUSHION_MATIC || 0.02);

console.log('📊 EXAMPLE CALCULATION (1000 transactions):');
console.log('─────────────────────────────────────────────');
console.log(`Gas per tx:        80,000 gas`);
console.log(`Gas price:         50 gwei (typical)`);
console.log(`Cost per tx:       0.004 MATIC`);
console.log(`Base cost (1000):  4.0 MATIC`);
console.log(`Buffer (${bufferPercent}%):       ${(4.0 * bufferPercent / 100).toFixed(2)} MATIC`);
console.log(`Cushion:           ${cushionMatic} MATIC`);
console.log(`─────────────────────────────────────────────`);
console.log(`TOTAL ESTIMATED:   ${(4.0 * (1 + bufferPercent / 100) + cushionMatic).toFixed(2)} MATIC`);
console.log('\n');
