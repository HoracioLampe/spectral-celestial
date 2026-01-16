
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const vault = require('../services/vault');

async function find() {
    const addr = '0xD6499E85D9c858f44E1312Ad27c7f48FF6743112';
    console.log(`Checking Vault for ${addr}...`);
    const pk = await vault.getRelayerKey(addr);
    if (pk) {
        console.log("✅ Key found in Vault!");
        console.log(`PK: ${pk}`);
    } else {
        console.log("❌ Key NOT found in Vault.");
    }

    process.exit(0);
}

find();
