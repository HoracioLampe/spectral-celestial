
const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function exportSchema() {
    try {
        console.log("🔍 Extracting Schema...");

        let sql = "-- Spectral Celestial Schema Export\n";
        sql += `-- Generated at: ${new Date().toISOString()}\n\n`;

        // Get Tables
        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema='public' 
            AND table_type='BASE TABLE'
            ORDER BY table_name;
        `);

        for (const row of tablesRes.rows) {
            const table = row.table_name;
            sql += `CREATE TABLE IF NOT EXISTS ${table} (\n`;

            // Get Columns
            const colsRes = await pool.query(`
                SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = $1 
                ORDER BY ordinal_position
            `, [table]);

            const cols = colsRes.rows.map(c => {
                let line = `    ${c.column_name} ${c.data_type}`;
                if (c.character_maximum_length) line += `(${c.character_maximum_length})`;
                if (c.is_nullable === 'NO') line += ' NOT NULL';
                if (c.column_default) line += ` DEFAULT ${c.column_default}`;
                return line;
            });

            sql += cols.join(',\n');

            // Get Constraints (PKs)
            const pkRes = await pool.query(`
                SELECT kcu.column_name
                FROM information_schema.table_constraints tco
                JOIN information_schema.key_column_usage kcu 
                    ON kcu.constraint_name = tco.constraint_name
                    AND kcu.table_schema = tco.table_schema
                WHERE tco.constraint_type = 'PRIMARY KEY'
                AND tco.table_name = $1
            `, [table]);

            if (pkRes.rows.length > 0) {
                sql += `,\n    PRIMARY KEY (${pkRes.rows.map(r => r.column_name).join(', ')})`;
            }

            sql += `\n);\n\n`;
        }

        console.log("✅ Schema generated.");
        fs.writeFileSync('schema.sql', sql);
        console.log("💾 Saved to schema.sql");

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

exportSchema();
