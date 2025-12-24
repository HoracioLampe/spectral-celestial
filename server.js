const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Multer para subida de archivos
const upload = multer({ dest: 'uploads/' });

// Configuración de PostgreSQL
// Railway provee automáticamente la variable DATABASE_URL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar base de datos
const initDB = async () => {
    try {
        if (!process.env.DATABASE_URL) {
            console.log("⚠️ DATABASE_URL no está definida (Probablemente en local). Saltando DB.");
            return;
        }
        const client = await pool.connect();
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(100),
                    apellido VARCHAR(100),
                    dni VARCHAR(20) UNIQUE,
                    edad INTEGER,
                    sexo VARCHAR(20),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS courses (
                    id SERIAL PRIMARY KEY,
                    nombre VARCHAR(150),
                    descripcion TEXT,
                    nivel VARCHAR(50),
                    fecha_inicio DATE,
                    duracion_semanas INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id SERIAL PRIMARY KEY,
                    tx_hash VARCHAR(66) UNIQUE NOT NULL,
                    from_address VARCHAR(42) NOT NULL,
                    to_address VARCHAR(42) NOT NULL,
                    amount VARCHAR(50) NOT NULL,
                    gas_used VARCHAR(50),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            // Tablas para Gestión de Lotes (Refactored)
            await client.query(`
                CREATE TABLE IF NOT EXISTS batches (
                    id SERIAL PRIMARY KEY,
                    batch_number VARCHAR(50),
                    detail TEXT,
                    description TEXT,
                    total_usdc NUMERIC DEFAULT 0,
                    total_transactions INTEGER DEFAULT 0,
                    sent_transactions INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'PREPARING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                CREATE TABLE IF NOT EXISTS batch_transactions (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    wallet_address VARCHAR(100),
                    amount_usdc NUMERIC,
                    tx_hash VARCHAR(100),
                    transaction_reference VARCHAR(100),
                    status VARCHAR(20) DEFAULT 'PENDING'
                );
            `);

            // Migración segura: Agregar columnas nuevas si faltan
            await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gas_used VARCHAR(50)`);
            await client.query(`ALTER TABLE batch_transactions ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(100)`);

            // Migración Lotes Refactor
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS total_transactions INTEGER DEFAULT 0`);
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS sent_transactions INTEGER DEFAULT 0`);
            await client.query(`ALTER TABLE batches ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PREPARING'`);

            console.log("✅ Tablas verificadas/actualizadas correctamente.");
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ Error conectando a BD:", err);
    }
};
initDB();

// Endpoint de Ayuda: Forzar creación de tablas manualmente
app.get('/setup', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query(`
             CREATE TABLE IF NOT EXISTS batches (
                    id SERIAL PRIMARY KEY,
                    batch_number VARCHAR(50),
                    detail TEXT,
                    description TEXT,
                    total_usdc NUMERIC DEFAULT 0,
                    total_transactions INTEGER DEFAULT 0,
                    sent_transactions INTEGER DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'PREPARING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            CREATE TABLE IF NOT EXISTS batch_transactions (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    wallet_address VARCHAR(100),
                    amount_usdc NUMERIC,
                    tx_hash VARCHAR(100),
                    transaction_reference VARCHAR(100),
                    status VARCHAR(20) DEFAULT 'PENDING'
                );
            ALTER TABLE batch_transactions ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(100);
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS total_transactions INTEGER DEFAULT 0;
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS sent_transactions INTEGER DEFAULT 0;
            ALTER TABLE batches ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PREPARING';
        `);
        client.release();
        res.send("<h1>✅ Tablas de Lotes actualizadas (Refactor).</h1>");
    } catch (err) {
        res.status(500).json(err);
    }
});

// ... (API Endpoints: USUARIOS y CURSOS) ...
app.get('/api/users', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/users', async (req, res) => {
    const { nombre, apellido, dni, edad, sexo } = req.body;
    try {
        const query = 'INSERT INTO users (nombre, apellido, dni, edad, sexo) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const values = [nombre, apellido, dni, edad, sexo];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, apellido, dni, edad, sexo } = req.body;
    try {
        const query = 'UPDATE users SET nombre=$1, apellido=$2, dni=$3, edad=$4, sexo=$5 WHERE id=$6 RETURNING *';
        const result = await pool.query(query, [nombre, apellido, dni, edad, sexo, id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/users/:id', async (req, res) => {
    try { await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]); res.json({ message: "Usuario eliminado" }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/courses', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM courses ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/courses', async (req, res) => {
    const { nombre, descripcion, nivel, fecha_inicio, duracion_semanas } = req.body;
    try {
        const query = 'INSERT INTO courses (nombre, descripcion, nivel, fecha_inicio, duracion_semanas) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const result = await pool.query(query, [nombre, descripcion, nivel, fecha_inicio, duracion_semanas]);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/courses/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, nivel, fecha_inicio, duracion_semanas } = req.body;
    try {
        const query = 'UPDATE courses SET nombre=$1, descripcion=$2, nivel=$3, fecha_inicio=$4, duracion_semanas=$5 WHERE id=$6 RETURNING *';
        const result = await pool.query(query, [nombre, descripcion, nivel, fecha_inicio, duracion_semanas, id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/courses/:id', async (req, res) => {
    try { await pool.query('DELETE FROM courses WHERE id=$1', [req.params.id]); res.json({ message: "Curso eliminado" }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API Endpoints: TRANSACCIONES ---

app.get('/api/transactions', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM transactions ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/transactions', async (req, res) => {
    const { tx_hash, from_address, to_address, amount, gas_used } = req.body;
    try {
        const query = 'INSERT INTO transactions (tx_hash, from_address, to_address, amount, gas_used) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const values = [tx_hash, from_address, to_address, amount.toString(), gas_used ? gas_used.toString() : "0"];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- API Endpoints: GESTIÓN DE LOTES (Refactored) ---

// POST: Crear nuevo Lote (Solo Cabecera Básica)
app.post('/api/batches', async (req, res) => {
    const { batch_number, detail, description } = req.body;
    try {
        // Status por defecto: PREPARING
        const query = `
            INSERT INTO batches (batch_number, detail, description, status) 
            VALUES ($1, $2, $3, 'PREPARING') RETURNING *
        `;
        const values = [batch_number, detail, description];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Subir Excel + Calcular Totales + Actualizar Estado a READY
app.post('/api/batches/:id/upload', upload.single('file'), async (req, res) => {
    const batchId = req.params.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        // Leer archivo Excel
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let totalAmount = 0;
            let totalCount = 0;

            for (const row of data) {
                // "TransactionID", "Address Wallet", "USDC", "Hash"
                const txRef = row['TransactionID'] || row['TransactionId'] || '';
                const wallet = row['Address Wallet'];
                const amount = parseFloat(row['USDC']);
                const hash = row['Hash'] || '';

                if (wallet && !isNaN(amount)) {
                    await client.query(
                        `INSERT INTO batch_transactions (batch_id, wallet_address, amount_usdc, tx_hash, transaction_reference) VALUES ($1, $2, $3, $4, $5)`,
                        [batchId, wallet, amount, hash, txRef]
                    );
                    totalAmount += amount;
                    totalCount++;
                }
            }

            // Actualizar Cabecera del Lote
            await client.query(
                `UPDATE batches SET total_usdc = $1, total_transactions = $2, status = 'READY' WHERE id = $3`,
                [totalAmount, totalCount, batchId]
            );

            await client.query('COMMIT');
            fs.unlinkSync(req.file.path);

            const updatedBatch = await client.query('SELECT * FROM batches WHERE id = $1', [batchId]);
            const txs = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [batchId]);

            res.json({
                message: 'Lote procesado y calculado',
                batch: updatedBatch.rows[0],
                transactions: txs.rows
            });

        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Obtener todos los lotes
app.get('/api/batches', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM batches ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET: Obtener detalle de un lote
app.get('/api/batches/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const batch = await pool.query('SELECT * FROM batches WHERE id = $1', [id]);
        if (batch.rows.length === 0) return res.status(404).json({ error: 'Lote no encontrado' });

        const txs = await pool.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [id]);

        res.json({ batch: batch.rows[0], transactions: txs.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fallback para SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
