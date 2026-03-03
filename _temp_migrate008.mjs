
import pg from 'pg';
import fs from 'fs';
import { config } from 'dotenv';

config();
const { Pool } = pg;

const devUrl = (process.env.DATABASE_URL || '').replace(/^['"]|['"]$/g, '').trim();
const railwayUrl = 'postgresql://postgres:rQUjVTBMaqsfsBzJNEEcmjmcxXkGoSKc@ballast.proxy.rlwy.net:57867/railway';
const sql = fs.readFileSync('./migrations/008_instant_api_logs_ip.sql', 'utf8');

for (const [name, url] of [['dev', devUrl], ['Railway', railwayUrl]]) {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
        await pool.query(sql);
        console.log(`✅ Migration 008 applied to ${name}`);
    } catch (e) {
        console.error(`❌ ${name}: ${e.message}`);
    }
    await pool.end();
}
process.exit(0);
