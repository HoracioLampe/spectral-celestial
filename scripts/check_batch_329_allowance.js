require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkBatch329Details() {
    try {
        const batchId = 329;

        console.log(`\n📊 Análisis Detallado Batch ${batchId}\n`);

        // Get total USDC needed
        const totalRes = await pool.query(`
            SELECT 
                SUM(amount_usdc) as total_usdc,
                COUNT(*) as tx_count
            FROM batch_transactions
            WHERE batch_id = $1
        `, [batchId]);

        const totalUsdc = parseFloat(totalRes.rows[0].total_usdc || 0) / 1000000;
        const txCount = totalRes.rows[0].tx_count;

        console.log(`💰 Total USDC necesario: ${totalUsdc.toFixed(6)} USDC`);
        console.log(`📝 Cantidad de transacciones: ${txCount}\n`);

        // Get allowance
        const allowance = 0.0001; // From previous check

        console.log(`✅ Allowance actual: ${allowance} USDC`);
        console.log(`📊 Comparación:`);
        console.log(`   Necesario: ${totalUsdc.toFixed(6)} USDC`);
        console.log(`   Aprobado:  ${allowance} USDC`);
        console.log(`   Ratio:     ${(allowance / totalUsdc).toFixed(2)}x\n`);

        if (allowance >= totalUsdc) {
            console.log(`✅ El allowance ES SUFICIENTE (${(allowance / totalUsdc).toFixed(2)}x más de lo necesario)`);
            console.log(`\n⚠️  El problema NO es el allowance. Investigando otras causas...\n`);
        } else {
            console.log(`❌ El allowance NO es suficiente`);
            console.log(`   Falta: ${(totalUsdc - allowance).toFixed(6)} USDC\n`);
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkBatch329Details();
