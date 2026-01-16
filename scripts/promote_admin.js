const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const walletAddress = '0x484c0fce584d5337688beafc6f4fe133a944c6ec';

async function promote() {
    try {
        console.log(`🚀 Promoting ${walletAddress} to SUPER_ADMIN...`);
        const query = `
            INSERT INTO rbac_users (address, role) 
            VALUES ($1, 'SUPER_ADMIN')
            ON CONFLICT (address) 
            DO UPDATE SET role = 'SUPER_ADMIN';
        `;
        await pool.query(query, [walletAddress]);
        console.log('✅ Success! Wallet is now SUPER_ADMIN.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

promote();
