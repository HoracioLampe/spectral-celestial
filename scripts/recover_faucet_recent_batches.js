require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const FAUCET_ADDRESS = '0x8Dd04f10017cc395F052d405354823b258343921';
const RPC_URL = process.env.RPC_URL;
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function recover() {
    try {
        console.log(`🔍 Buscando funder para el Faucet: ${FAUCET_ADDRESS}`);

        // El faucet y el funder están ligados en la tabla faucets
        const faucetRes = await pool.query(
            'SELECT funder_address FROM faucets WHERE address = $1',
            [FAUCET_ADDRESS]
        );

        if (faucetRes.rows.length === 0) {
            console.log('❌ No se encontró faucet en la tabla faucets.');
            return;
        }

        const funderAddress = faucetRes.rows[0].funder_address;
        console.log(`✅ Funder encontrado: ${funderAddress}`);

        console.log(`🔍 Buscando últimos 3 batches para el funder: ${funderAddress}`);
        const batchRes = await pool.query(
            'SELECT id FROM batches WHERE funder_address = $1 ORDER BY id DESC LIMIT 3',
            [funderAddress]
        );

        const batchIds = batchRes.rows.map(r => r.id);
        if (batchIds.length === 0) {
            console.log('❌ No se encontraron batches para este funder.');
            return;
        }

        console.log(`✅ Batches encontrados: ${batchIds.join(', ')}`);

        // Usamos la tabla 'relayers' que es la correcta según el código del engine
        const relayerRes = await pool.query(
            'SELECT DISTINCT address, private_key FROM relayers WHERE batch_id = ANY($1)',
            [batchIds]
        );

        const relayers = relayerRes.rows;
        console.log(`📦 Encontrados ${relayers.length} relayers únicos.`);

        const feeData = await provider.getFeeData();
        const gasPrice = (feeData.gasPrice * 3n) / 1n; // 3x boost para recuperación agresiva

        for (const relayer of relayers) {
            try {
                const wallet = new ethers.Wallet(relayer.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                // Solo recuperar si tiene más de 0.01 MATIC (aprox) para que valga la pena el gas
                if (balance > ethers.parseEther("0.01")) {
                    const gasLimit = 21000n;
                    const cost = gasPrice * gasLimit;

                    if (balance > cost) {
                        const amountToSend = balance - cost;
                        console.log(`💸 Recuperando ${ethers.formatEther(amountToSend)} MATIC de ${wallet.address}...`);

                        const tx = await wallet.sendTransaction({
                            to: FAUCET_ADDRESS,
                            value: amountToSend,
                            gasPrice: gasPrice,
                            gasLimit: gasLimit
                        });
                        console.log(`✅ TX Enviada: ${tx.hash}`);

                        // Opcional: Marcar como 'drained' si existe la columna o simplemente loguear
                        await pool.query(
                            'UPDATE relayers SET status = $1 WHERE address = $2',
                            ['drained', wallet.address]
                        );

                    } else {
                        console.log(`⚠️  Balance insuficiente en ${wallet.address} (${ethers.formatEther(balance)}) para pagar gas.`);
                    }
                } else {
                    console.log(`ℹ️  Relayer ${wallet.address} con balance bajo (${ethers.formatEther(balance)} MATIC).`);
                }
            } catch (err) {
                console.error(`❌ Error recuperando de ${relayer.address}:`, err.message);
            }
        }

        console.log('\n✨ Proceso de recuperación finalizado.');

    } catch (err) {
        console.error('❌ Error fatal:', err);
    } finally {
        await pool.end();
    }
}

recover();
