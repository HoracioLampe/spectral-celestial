require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const RPC_URL = process.env.RPC_URL || "https://polygon-mainnet.core.chainstack.com/05aa9ef98aa83b585c14fa0438ed53a9";

async function recoverSpecificRelayer() {
    try {
        const relayerAddress = '0x9fC2b943d978dfB5F56BBDC009375B58FB01bA38';

        console.log(`\n🔍 Buscando relayer: ${relayerAddress}\n`);

        // Find relayer in database
        const relayerRes = await pool.query(`
            SELECT r.*, b.funder_address
            FROM relayers r
            JOIN batches b ON r.batch_id = b.id
            WHERE LOWER(r.address) = LOWER($1)
        `, [relayerAddress]);

        if (relayerRes.rows.length === 0) {
            console.log('❌ Relayer no encontrado en la base de datos');
            return;
        }

        const relayer = relayerRes.rows[0];
        console.log(`✅ Relayer encontrado:`);
        console.log(`   Batch ID: ${relayer.batch_id}`);
        console.log(`   Funder: ${relayer.funder_address}`);
        console.log(`   Balance (BD): ${relayer.last_balance || '0'} MATIC\n`);

        // Get Faucet for this funder
        const faucetRes = await pool.query(`
            SELECT address FROM faucets 
            WHERE LOWER(funder_address) = LOWER($1) LIMIT 1
        `, [relayer.funder_address]);

        if (faucetRes.rows.length === 0) {
            console.log(`❌ No se encontró Faucet para el funder ${relayer.funder_address}`);
            return;
        }

        const faucetAddress = faucetRes.rows[0].address;
        console.log(`💰 Faucet destino: ${faucetAddress}\n`);

        // Connect to blockchain and recover funds
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(relayer.private_key, provider);

        const balance = await provider.getBalance(wallet.address);
        console.log(`💵 Balance actual (blockchain): ${ethers.formatEther(balance)} MATIC\n`);

        if (balance === 0n) {
            console.log('⚠️  Balance es 0, nada que recuperar');
            return;
        }

        // Calculate gas and send
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || 50000000000n;
        const gasCost = 21000n * gasPrice;
        const amountToSend = balance - gasCost;

        if (amountToSend <= 0n) {
            console.log('⚠️  Balance insuficiente para cubrir gas');
            return;
        }

        console.log(`📤 Enviando ${ethers.formatEther(amountToSend)} MATIC al Faucet...`);

        const tx = await wallet.sendTransaction({
            to: faucetAddress,
            value: amountToSend,
            gasLimit: 21000,
            gasPrice: gasPrice
        });

        console.log(`🚀 TX enviada: ${tx.hash}`);
        console.log(`⏳ Esperando confirmación...`);

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`\n✅ ¡Fondos recuperados exitosamente!`);
            console.log(`   Monto: ${ethers.formatEther(amountToSend)} MATIC`);
            console.log(`   TX: ${tx.hash}`);
            console.log(`   Destino: ${faucetAddress}\n`);
        } else {
            console.log(`\n❌ Transacción falló\n`);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

recoverSpecificRelayer();
