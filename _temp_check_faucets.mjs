// _temp_check_faucets.mjs
// Check available faucet wallets for deploying InstantPayment contract
import pkg from 'pg';
const { Pool } = pkg;
import { ethers } from 'ethers';
import crypto from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function decrypt(encryptedHex) {
    const buf = Buffer.from(encryptedHex, 'hex');
    const iv = buf.slice(0, 16);
    const encrypted = buf.slice(16);
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return decipher.update(encrypted) + decipher.final('utf8');
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_1);

try {
    // Get faucet wallets
    const result = await pool.query(`
        SELECT id, address, encrypted_private_key, funder_address
        FROM faucets
        ORDER BY id
        LIMIT 5
    `);

    console.log('[OK] Faucet wallets found:', result.rows.length);

    for (const row of result.rows) {
        try {
            const pk = decrypt(row.encrypted_private_key);
            const wallet = new ethers.Wallet(pk, provider);
            const balance = await provider.getBalance(wallet.address);
            const balancePOL = parseFloat(ethers.formatEther(balance)).toFixed(4);
            console.log(`  ID: ${row.id} | Address: ${wallet.address} | POL: ${balancePOL} | Funder: ${row.funder_address || 'none'}`);
        } catch (e) {
            console.log(`  ID: ${row.id} | Address: ${row.address} | [decrypt error: ${e.message}]`);
        }
    }
} catch (err) {
    console.error('[!] Error:', err.message);
} finally {
    await pool.end();
    process.exit(0);
}
