
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const faucetAddress = '0xB4C367834e3Ea0B85dbC50846A9A6A3c40DFb259';
const recipientAddress = '0x1cc87a77516F41f17f2D91C57DAE1D00B263F2B0';

async function investigate() {
    console.log(`🕵️‍♂️ Investigating transfer from ${faucetAddress} to ${recipientAddress}...\n`);

    try {
        // 1. Identify the Faucet
        const faucetRes = await pool.query('SELECT * FROM faucets WHERE lower(address) = lower($1)', [faucetAddress]);
        if (faucetRes.rows.length > 0) {
            const faucet = faucetRes.rows[0];
            console.log(`✅ SENDER IS FAUCET. Owner (Funder): ${faucet.funder_address}`);

            // Check if Recipient is the Owner
            if (faucet.funder_address.toLowerCase() === recipientAddress.toLowerCase()) {
                console.log(`🎯 MATCH: The recipient IS the Funder (Owner) of this Faucet.`);
                console.log(`   This suggests a "Return Funds" or "Sweep" operation.`);
            } else {
                console.log(`⚠️ MISMATCH: Recipient is NOT the Funder.`);
            }
        } else {
            console.log(`❌ Sender ${faucetAddress} is NOT in the 'faucets' table.`);
        }

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await pool.end();
    }
}

investigate();
