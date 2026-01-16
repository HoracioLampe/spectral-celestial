const { ethers } = require('ethers');
require('dotenv').config();

async function checkWalletNonce() {
    const walletAddress = '0xB4C367834e3Ea0B85dbC50846A9A6A3c40DFb259';

    // Connect to Polygon RPC
    const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    console.log(`\n🔍 Diagnosticando Wallet: ${walletAddress}\n`);

    try {
        // Get nonce counts
        const latestNonce = await provider.getTransactionCount(walletAddress, "latest");
        const pendingNonce = await provider.getTransactionCount(walletAddress, "pending");

        // Get balance
        const balance = await provider.getBalance(walletAddress);

        console.log(`📊 Estado de la Wallet:`);
        console.log(`   Balance: ${ethers.formatEther(balance)} POL`);
        console.log(`   Nonce Latest (confirmado): ${latestNonce}`);
        console.log(`   Nonce Pending (mempool): ${pendingNonce}`);
        console.log(`   Diferencia: ${pendingNonce - latestNonce}`);

        if (pendingNonce > latestNonce) {
            console.log(`\n⚠️  WALLET BLOQUEADA DETECTADA!`);
            console.log(`   Hay ${pendingNonce - latestNonce} transacción(es) atascada(s) en el mempool.`);
            console.log(`   Nonce bloqueado en: ${latestNonce}`);
            console.log(`\n💡 Solución: Necesitas enviar una transacción con nonce ${latestNonce} y gas más alto para desbloquear.`);

            // Get current gas price
            const feeData = await provider.getFeeData();
            const currentGasPrice = feeData.gasPrice;
            const recommendedGasPrice = (currentGasPrice * 150n) / 100n; // 50% más alto

            console.log(`\n⛽ Gas Recomendado:`);
            console.log(`   Gas Actual: ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);
            console.log(`   Gas Recomendado (150%): ${ethers.formatUnits(recommendedGasPrice, 'gwei')} gwei`);

        } else {
            console.log(`\n✅ Wallet OK - No hay transacciones bloqueadas.`);
        }

        // Check recent transactions
        console.log(`\n🔎 Buscando transacciones recientes...`);
        const latestBlock = await provider.getBlockNumber();
        const startBlock = latestBlock - 1000; // Last ~30 minutes

        try {
            const history = await provider.getHistory(walletAddress, startBlock, latestBlock);
            if (history && history.length > 0) {
                console.log(`   Encontradas ${history.length} transacciones en los últimos ~30 minutos:`);
                history.slice(-5).forEach(tx => {
                    console.log(`   - Hash: ${tx.hash} | Nonce: ${tx.nonce} | Status: ${tx.blockNumber ? 'Confirmada' : 'Pendiente'}`);
                });
            } else {
                console.log(`   No se encontraron transacciones recientes.`);
            }
        } catch (histErr) {
            console.log(`   ⚠️  No se pudo obtener el historial (puede ser limitación del RPC).`);
        }

    } catch (error) {
        console.error(`\n❌ Error al verificar la wallet:`, error.message);
    }
}

checkWalletNonce().catch(console.error);
