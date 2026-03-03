import fs from 'fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const lines = html.split('\n');

// Find key line numbers (0-indexed)
const ipSectionLine = lines.findIndex(l => l.includes('id="instantPaymentSection"'));
const apiKeyLine = lines.findIndex(l => l.includes('id="ipApiKeyPanel"'));
const ipCloseLine = lines.findIndex(l => l.includes('Fin instantPaymentSection'));

console.log('instantPaymentSection opens at line:', ipSectionLine + 1);
console.log('ipApiKeyPanel is at line:', apiKeyLine + 1);
console.log('Fin instantPaymentSection is at line:', ipCloseLine + 1);
console.log('API Key IS inside IP section:', apiKeyLine > ipSectionLine && apiKeyLine < ipCloseLine);
console.log('');

// Count unclosed divs between ip section open and api key panel
const between = lines.slice(ipSectionLine, apiKeyLine).join('\n');
const opens = (between.match(/<div/g) || []).length;
const closes = (between.match(/<\/div>/g) || []).length;
console.log('Divs opened between IP start and API Key:', opens);
console.log('Divs closed between IP start and API Key:', closes);
console.log('Net open divs (should be > 0 if API Key is inside):', opens - closes);
