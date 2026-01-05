// El error del log muestra:
// balance 42000000000000000 (0.042 MATIC)
// tx cost 70656852704565372 (0.0706 MATIC)
// overshot 28656852704565372 (0.0286 MATIC de diferencia)

const balance = 0.042; // MATIC
const txCost = 0.0706; // MATIC
const overshot = 0.0286; // MATIC

console.log('\n📊 Análisis del Error de Gas\n');
console.log(`Balance del relayer: ${balance} MATIC`);
console.log(`Costo estimado TX:   ${txCost} MATIC`);
console.log(`Faltante:            ${overshot} MATIC\n`);

// El costo de 0.0706 MATIC es DEMASIADO ALTO
// Una transacción normal debería costar ~0.001-0.005 MATIC

const gasLimit = 200000; // Estimado del contrato
const gasPrice = 70656852704565372 / gasLimit; // Wei por gas

console.log(`Gas Limit estimado:  ${gasLimit}`);
console.log(`Gas Price calculado: ${(gasPrice / 1e9).toFixed(2)} gwei\n`);

console.log('💡 Problema identificado:');
console.log('   El sistema está calculando un gas price MUY ALTO');
console.log('   o el gas limit está sobrestimado.\n');

console.log('✅ Solución:');
console.log('   1. Reducir el gas buffer del 15% actual');
console.log('   2. Verificar que el cap de 100 gwei esté funcionando');
console.log('   3. Usar gas price más conservador (30-50 gwei)\n');
