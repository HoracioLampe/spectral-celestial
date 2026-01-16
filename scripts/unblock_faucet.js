require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');
const encryptionService = require('../services/encryption');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// RPC URLs
const rpcUrls = [
    process.env.RPC_URL_1,
    process.env.RPC_URL_2,
    process.env.RPC_URL_3,
    process.env.RPC_URL_4,
    process.env.RPC_URL_5
].filter(Boolean);

async function unblockFaucet(faucetAddress) {
    const client = await pool.connect();

    try {
        console.log(`🔧 Desbloqueando faucet: ${faucetAddress}\n`);

        // 1. Obtener la clave privada encriptada
        const faucetRes = await client.query(
            'SELECT encrypted_key FROM faucets WHERE address = $1',
            [faucetAddress.toLowerCase()]
        );

        if (faucetRes.rows.length === 0 || !faucetRes.rows[0].encrypted_key) {
            throw new Error('Faucet no encontrado o sin clave encriptada');
        }

        const privateKey = encryptionService.decrypt(faucetRes.rows[0].encrypted_key);

        // 2. Conectar a RPC
        let provider;
        for (const rpcUrl of rpcUrls) {
            try {
                provider = new ethers.JsonRpcProvider(rpcUrl);
                await provider.getBlockNumber(); // Test connection
                console.log(`✅ Conectado a RPC: ${rpcUrl.substring(0, 50)}...`);
                break;
            } catch (e) {
                console.log(`⚠️  RPC falló: ${rpcUrl.substring(0, 50)}...`);
            }
        }

        if (!provider) {
            throw new Error('No se pudo conectar a ningún RPC');
        }

        const wallet = new ethers.Wallet(privateKey, provider);

        // 3. Verificar estado del nonce
        const [latestNonce, pendingNonce, balance] = await Promise.all([
            provider.getTransactionCount(faucetAddress, 'latest'),
            provider.getTransactionCount(faucetAddress, 'pending'),
            provider.getBalance(faucetAddress)
        ]);

        console.log(`📊 Estado del Faucet:`);
        console.log(`   Address: ${faucetAddress}`);
        console.log(`   Balance: ${ethers.formatEther(balance)} MATIC`);
        console.log(`   Latest Nonce: ${latestNonce}`);
        console.log(`   Pending Nonce: ${pendingNonce}`);
        console.log(`   Diferencia: ${pendingNonce - latestNonce}`);

        const isBlocked = pendingNonce > latestNonce;

        if (!isBlocked) {
            console.log(`\n✅ El faucet NO está bloqueado. Nonces coinciden.`);
            return;
        }

        console.log(`\n⚠️  FAUCET BLOQUEADO! ${pendingNonce - latestNonce} transacciones pendientes`);

        // 4. Verificar que tenga suficiente balance
        const minBalance = ethers.parseEther('0.01'); // 0.01 MATIC mínimo
        if (balance < minBalance) {
            throw new Error(`Balance insuficiente: ${ethers.formatEther(balance)} MATIC. Necesita al menos 0.01 MATIC`);
        }

        // 5. Obtener fee data
        const feeData = await provider.getFeeData();
        console.log(`\n💰 Fee Data:`);
        console.log(`   Gas Price: ${ethers.formatUnits(feeData.gasPrice, 'gwei')} gwei`);
        console.log(`   Max Fee: ${ethers.formatUnits(feeData.maxFeePerGas, 'gwei')} gwei`);
        console.log(`   Max Priority: ${ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei')} gwei`);

        // 6. Enviar transacción de desbloqueo con gas alto (3x)
        const boostGasPrice = (feeData.gasPrice * 30n) / 10n; // 3x gas price

        console.log(`\n🚀 Enviando transacción de desbloqueo...`);
        console.log(`   Nonce: ${latestNonce}`);
        console.log(`   Gas Price (boosted): ${ethers.formatUnits(boostGasPrice, 'gwei')} gwei`);

        const tx = await wallet.sendTransaction({
            to: faucetAddress, // Self-transaction
            value: 0,
            nonce: latestNonce,
            gasLimit: 30000,
            gasPrice: boostGasPrice
        });

        console.log(`\n📤 Transacción enviada: ${tx.hash}`);
        console.log(`   Esperando confirmación...`);

        // 7. Esperar confirmación con timeout
        const receipt = await Promise.race([
            tx.wait(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout esperando confirmación')), 120000)
            )
        ]);

        console.log(`\n✅ Transacción confirmada!`);
        console.log(`   Block: ${receipt.blockNumber}`);
        console.log(`   Gas usado: ${receipt.gasUsed.toString()}`);

        // 8. Verificar nuevo estado
        const [newLatest, newPending] = await Promise.all([
            provider.getTransactionCount(faucetAddress, 'latest'),
            provider.getTransactionCount(faucetAddress, 'pending')
        ]);

        console.log(`\n📊 Nuevo estado:`);
        console.log(`   Latest Nonce: ${newLatest}`);
        console.log(`   Pending Nonce: ${newPending}`);
        console.log(`   Estado: ${newLatest === newPending ? '✅ DESBLOQUEADO' : '⚠️  AÚN BLOQUEADO'}`);

        if (newLatest === newPending) {
            console.log(`\n🎉 ¡Faucet desbloqueado exitosamente!`);
        } else {
            console.log(`\n⚠️  El faucet aún tiene ${newPending - newLatest} transacciones pendientes`);
            console.log(`   Puede necesitar múltiples ejecuciones de este script`);
        }

    } catch (error) {
        console.error(`\n❌ Error:`, error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Ejecutar
const faucetAddress = process.argv[2];

if (!faucetAddress) {
    console.error('❌ Uso: node unblock_faucet.js <FAUCET_ADDRESS>');
    process.exit(1);
}

unblockFaucet(faucetAddress).catch(console.error);
