
const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function exportSchema() {
    try {
        console.log("🔍 Extracting Complete Schema...");

        let sql = "-- Spectral Celestial Complete Schema Export\n";
        sql += `-- Generated at: ${new Date().toISOString()}\n`;
        sql += "-- Includes: Tables, Columns, Primary Keys, Foreign Keys, Indexes, Unique Constraints, Check Constraints\n\n";

        // ========== SEQUENCES ==========
        sql += "-- ========================================\n";
        sql += "-- SEQUENCES\n";
        sql += "-- ========================================\n\n";

        const sequencesRes = await pool.query(`
            SELECT sequence_name 
            FROM information_schema.sequences 
            WHERE sequence_schema = 'public'
            ORDER BY sequence_name;
        `);

        for (const row of sequencesRes.rows) {
            sql += `CREATE SEQUENCE IF NOT EXISTS ${row.sequence_name};\n`;
        }
        sql += "\n";

        // ========== TABLES ==========
        sql += "-- ========================================\n";
        sql += "-- TABLES\n";
        sql += "-- ========================================\n\n";

        const tablesRes = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema='public' 
            AND table_type='BASE TABLE'
            ORDER BY table_name;
        `);

        for (const row of tablesRes.rows) {
            const table = row.table_name;
            sql += `-- Table: ${table}\n`;
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

            // Get Primary Keys
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

        // ========== FOREIGN KEYS ==========
        sql += "-- ========================================\n";
        sql += "-- FOREIGN KEYS\n";
        sql += "-- ========================================\n\n";

        const fkRes = await pool.query(`
            SELECT
                tc.table_name,
                tc.constraint_name,
                kcu.column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);

        for (const fk of fkRes.rows) {
            sql += `ALTER TABLE ${fk.table_name}\n`;
            sql += `    ADD CONSTRAINT ${fk.constraint_name}\n`;
            sql += `    FOREIGN KEY (${fk.column_name})\n`;
            sql += `    REFERENCES ${fk.foreign_table_name} (${fk.foreign_column_name});\n\n`;
        }

        // ========== UNIQUE CONSTRAINTS ==========
        sql += "-- ========================================\n";
        sql += "-- UNIQUE CONSTRAINTS\n";
        sql += "-- ========================================\n\n";

        const uniqueRes = await pool.query(`
            SELECT
                tc.table_name,
                tc.constraint_name,
                string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'UNIQUE'
            AND tc.table_schema = 'public'
            GROUP BY tc.table_name, tc.constraint_name
            ORDER BY tc.table_name, tc.constraint_name;
        `);

        for (const unique of uniqueRes.rows) {
            sql += `ALTER TABLE ${unique.table_name}\n`;
            sql += `    ADD CONSTRAINT ${unique.constraint_name}\n`;
            sql += `    UNIQUE (${unique.columns});\n\n`;
        }

        // ========== CHECK CONSTRAINTS ==========
        sql += "-- ========================================\n";
        sql += "-- CHECK CONSTRAINTS\n";
        sql += "-- ========================================\n\n";

        const checkRes = await pool.query(`
            SELECT
                tc.table_name,
                tc.constraint_name,
                cc.check_clause
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.check_constraints AS cc
                ON tc.constraint_name = cc.constraint_name
                AND tc.constraint_schema = cc.constraint_schema
            WHERE tc.constraint_type = 'CHECK'
            AND tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);

        for (const check of checkRes.rows) {
            sql += `ALTER TABLE ${check.table_name}\n`;
            sql += `    ADD CONSTRAINT ${check.constraint_name}\n`;
            sql += `    CHECK ${check.check_clause};\n\n`;
        }

        // ========== INDEXES ==========
        sql += "-- ========================================\n";
        sql += "-- INDEXES\n";
        sql += "-- ========================================\n\n";

        const indexRes = await pool.query(`
            SELECT
                schemaname,
                tablename,
                indexname,
                indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND indexname NOT LIKE '%_pkey'
            ORDER BY tablename, indexname;
        `);

        for (const idx of indexRes.rows) {
            sql += `${idx.indexdef};\n`;
        }

        sql += "\n-- ========================================\n";
        sql += "-- END OF SCHEMA\n";
        sql += "-- ========================================\n";

        console.log("✅ Complete schema generated.");
        console.log(`   - ${tablesRes.rows.length} tables`);
        console.log(`   - ${fkRes.rows.length} foreign keys`);
        console.log(`   - ${uniqueRes.rows.length} unique constraints`);
        console.log(`   - ${checkRes.rows.length} check constraints`);
        console.log(`   - ${indexRes.rows.length} indexes`);

        fs.writeFileSync('schema.sql', sql);
        console.log("💾 Saved to schema.sql");

    } catch (err) {
        console.error("❌ Error:", err.message);
        console.error(err);
    } finally {
        pool.end();
    }
}

exportSchema();
