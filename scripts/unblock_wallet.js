const { ethers } = require('ethers');
const { Pool } = require('pg');
require('dotenv').config();

async function unblockWallet() {
    const targetAddress = '0xB4C367834e3Ea0B85dbC50846A9A6A3c40DFb259';

    // Database connection
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // RPC connection
    const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    console.log(`\n🔧 Desbloqueando Wallet: ${targetAddress}\n`);

    try {
        // 1. Get private key from database
        console.log(`📂 Buscando clave privada en la base de datos...`);
        const result = await pool.query(
            `SELECT private_key FROM faucets WHERE LOWER(address) = LOWER($1)`,
            [targetAddress]
        );

        if (result.rows.length === 0) {
            console.error(`❌ No se encontró la wallet en la tabla 'faucets'.`);
            console.log(`   Intentando buscar en 'relayers'...`);

            const relayerResult = await pool.query(
                `SELECT private_key FROM relayers WHERE LOWER(address) = LOWER($1) LIMIT 1`,
                [targetAddress]
            );

            if (relayerResult.rows.length === 0) {
                throw new Error(`Wallet no encontrada en la base de datos.`);
            }

            result.rows[0] = relayerResult.rows[0];
            console.log(`   ✅ Encontrada en 'relayers'.`);
        } else {
            console.log(`   ✅ Encontrada en 'faucets'.`);
        }

        const privateKey = result.rows[0].private_key;
        const wallet = new ethers.Wallet(privateKey, provider);

        // 2. Verify nonce status
        const latestNonce = await provider.getTransactionCount(wallet.address, "latest");
        const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
        const balance = await provider.getBalance(wallet.address);

        console.log(`\n📊 Estado Actual:`);
        console.log(`   Balance: ${ethers.formatEther(balance)} POL`);
        console.log(`   Nonce Latest: ${latestNonce}`);
        console.log(`   Nonce Pending: ${pendingNonce}`);
        console.log(`   Diferencia: ${pendingNonce - latestNonce}`);

        if (pendingNonce <= latestNonce) {
            console.log(`\n✅ La wallet NO está bloqueada. No se requiere acción.`);
            await pool.end();
            return;
        }

        console.log(`\n⚠️  Wallet bloqueada detectada. Procediendo a desbloquear...`);

        // 3. Get gas price and boost it
        const feeData = await provider.getFeeData();
        const currentGasPrice = feeData.gasPrice;
        const boostedGasPrice = (currentGasPrice * 200n) / 100n; // 100% boost (2x)

        console.log(`\n⛽ Configuración de Gas:`);
        console.log(`   Gas Actual: ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);
        console.log(`   Gas Boosted (200%): ${ethers.formatUnits(boostedGasPrice, 'gwei')} gwei`);

        // 4. Send self-transaction with stuck nonce
        console.log(`\n🚀 Enviando transacción de desbloqueo...`);
        console.log(`   Nonce a usar: ${latestNonce}`);
        console.log(`   Tipo: Auto-envío (0 POL)`);

        const tx = await wallet.sendTransaction({
            to: wallet.address,
            value: 0,
            nonce: latestNonce,
            gasLimit: 21000,
            gasPrice: boostedGasPrice
        });

        console.log(`\n📤 Transacción enviada: ${tx.hash}`);
        console.log(`   Esperando confirmación...`);

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`\n✅ WALLET DESBLOQUEADA EXITOSAMENTE!`);
            console.log(`   Block: ${receipt.blockNumber}`);
            console.log(`   Gas usado: ${receipt.gasUsed.toString()}`);
            console.log(`   Costo: ${ethers.formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} POL`);

            // Verify new nonce state
            const newLatest = await provider.getTransactionCount(wallet.address, "latest");
            const newPending = await provider.getTransactionCount(wallet.address, "pending");

            console.log(`\n📊 Estado Final:`);
            console.log(`   Nonce Latest: ${newLatest}`);
            console.log(`   Nonce Pending: ${newPending}`);
            console.log(`   Diferencia: ${newPending - newLatest}`);

            if (newPending === newLatest) {
                console.log(`\n🎉 Mempool limpio. La wallet está lista para usar.`);
            } else {
                console.log(`\n⚠️  Aún hay ${newPending - newLatest} tx pendiente(s). Puede requerir otra iteración.`);
            }
        } else {
            console.log(`\n❌ La transacción falló on-chain.`);
        }

    } catch (error) {
        console.error(`\n❌ Error al desbloquear la wallet:`, error.message);
        if (error.code) console.error(`   Código: ${error.code}`);
    } finally {
        await pool.end();
    }
}

unblockWallet().catch(console.error);
