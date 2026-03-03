import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '').trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const coldWallet = '0x9795E3A0D7824C651adF3880f976EbfdB0121E62'.toLowerCase();

const { rows } = await pool.query(
    `SELECT id, cold_wallet, key_prefix, is_active, access_count, last_accessed, created_at
     FROM instant_api_keys
     WHERE LOWER(cold_wallet) = $1`,
    [coldWallet]
);

if (rows.length === 0) {
    console.log('❌ No API key found for cold_wallet:', coldWallet);
} else {
    console.table(rows);
    console.log('\n💡 El API key completo no se puede recuperar (solo se guarda el hash SHA-256).');
    console.log('   Si no lo tenés guardado, hay que generar uno nuevo desde el panel admin.');
}

await pool.end();
process.exit(0);
