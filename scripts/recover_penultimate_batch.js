require('dotenv').config();
const { Pool } = require('pg');
const { ethers } = require('ethers');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const FUNDER_ADDRESS = '0x05dac55cc6fd7b84be32fd262ce4521eb6b29c38';
const FAUCET_ADDRESS = '0x8Dd04f10017cc395F052d405354823b258343921';
const RPC_URL = process.env.RPC_URL;
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function recover() {
    try {
        console.log(`🔍 Buscando anteúltimo batch para el funder: ${FUNDER_ADDRESS}`);

        const batchRes = await pool.query(
            'SELECT id, batch_number, status FROM batches WHERE funder_address = $1 ORDER BY id DESC LIMIT 2',
            [FUNDER_ADDRESS]
        );

        if (batchRes.rows.length < 2) {
            console.log('❌ No hay suficientes batches para encontrar el anteúltimo.');
            return;
        }

        const penultimateBatch = batchRes.rows[1];
        console.log(`✅ Anteúltimo Batch encontrado: ID ${penultimateBatch.id} (${penultimateBatch.status})`);

        const relayerRes = await pool.query(
            'SELECT DISTINCT address, private_key, last_balance FROM relayers WHERE batch_id = $1',
            [penultimateBatch.id]
        );

        const relayers = relayerRes.rows;
        console.log(`📦 Encontrados ${relayers.length} relayers para el Batch ${penultimateBatch.id}.`);

        const feeData = await provider.getFeeData();
        // Usamos 1.5x del actual para no pasarnos de mambo si el gas está muy caro
        const gasPrice = (feeData.gasPrice * 150n) / 100n;

        for (const relayer of relayers) {
            try {
                const wallet = new ethers.Wallet(relayer.private_key, provider);
                const balance = await provider.getBalance(wallet.address);

                if (balance > ethers.parseEther("0.1")) {
                    const gasLimit = 21000n;
                    const cost = gasPrice * gasLimit;

                    if (balance > cost) {
                        const amountToSend = balance - cost;
                        console.log(`💸 Recuperando ${ethers.formatEther(amountToSend)} MATIC de ${wallet.address} (Batch ${penultimateBatch.id})...`);

                        const tx = await wallet.sendTransaction({
                            to: FAUCET_ADDRESS,
                            value: amountToSend,
                            gasPrice: gasPrice,
                            gasLimit: gasLimit
                        });
                        console.log(`   ✅ TX Enviada: ${tx.hash}`);

                        await pool.query(
                            'UPDATE relayers SET status = $1, last_balance = $2 WHERE address = $3',
                            ['drained', '0', wallet.address]
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
