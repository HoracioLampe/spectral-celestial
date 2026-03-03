import pg from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '').trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const coldWallet = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62'.toLowerCase();

// Generar nueva API key segura
const rawKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');
const keyPrefix = rawKey.substring(0, 16); // VARCHAR(16) máximo en DB
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

// Upsert: si ya existe para esa cold wallet, reemplazar la key
await pool.query(`
    INSERT INTO instant_api_keys (cold_wallet, key_hash, key_prefix, is_active, access_count)
    VALUES ($1, $2, $3, true, 0)
    ON CONFLICT (cold_wallet) DO UPDATE
    SET key_hash = $2, key_prefix = $3, is_active = true, access_count = 0, updated_at = NOW()
`, [coldWallet, keyHash, keyPrefix]);

console.log('\n✅ API Key generada y guardada:');
console.log('   Cold Wallet :', coldWallet);
console.log('   Prefijo     :', keyPrefix);
console.log('   API KEY     :', rawKey);
console.log('\n⚠️  GUARDÁ ESTA KEY — no se puede recuperar después (solo se almacena el hash).\n');

await pool.end();
process.exit(0);
