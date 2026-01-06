
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const backupDir = path.join(__dirname, '../backups');

if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const currentBackupDir = path.join(backupDir, `backup-${timestamp}`);
fs.mkdirSync(currentBackupDir);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function backup() {
    try {
        console.log(`[Backup] Starting backup to: ${currentBackupDir}`);

        // Get all table names
        const res = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);

        const tables = res.rows.map(r => r.table_name);
        console.log(`[Backup] Found ${tables.length} tables: ${tables.join(', ')}`);

        for (const table of tables) {
            console.log(`[Backup] Backing up table: ${table}...`);
            const tableRes = await pool.query(`SELECT * FROM "${table}"`);
            const filePath = path.join(currentBackupDir, `${table}.json`);

            fs.writeFileSync(filePath, JSON.stringify(tableRes.rows, null, 2));
            console.log(`[Backup] ✅ Saved ${tableRes.rowCount} rows to ${table}.json`);
        }

        console.log(`[Backup] 🎉 All tables backed up successfully!`);
    } catch (err) {
        console.error("[Backup] ❌ Error:", err);
    } finally {
        await pool.end();
    }
}

backup();
