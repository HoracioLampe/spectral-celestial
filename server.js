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
            // Tablas para Gestión de Lotes
            await client.query(`
                CREATE TABLE IF NOT EXISTS batches (
                    id SERIAL PRIMARY KEY,
                    batch_number VARCHAR(50),
                    detail TEXT,
                    description TEXT,
                    scheduled_date VARCHAR(50),
                    start_time VARCHAR(50),
                    end_time VARCHAR(50),
                    total_usdc NUMERIC,
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
                    status VARCHAR(20) DEFAULT 'PENDING'
                );
            `);

            // Migración segura: Agregar columna si no existe
            await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gas_used VARCHAR(50)`);

            console.log("✅ Tabla 'courses' verificada/creada.");
            console.log("✅ Tabla 'users' verificada/creada.");
            console.log("✅ Tabla 'transactions' verificada/creada + Columna gas_used.");
            console.log("✅ Tablas 'batches' y 'batch_transactions' verificadas/creadas.");
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
        // ... (Tablas anteriores omitidas por brevedad, initDB ya las maneja)
        // Solo asegurar las nuevas aquí también si se llama manual
        await client.query(`
             CREATE TABLE IF NOT EXISTS batches (
                    id SERIAL PRIMARY KEY,
                    batch_number VARCHAR(50),
                    detail TEXT,
                    description TEXT,
                    scheduled_date VARCHAR(50),
                    start_time VARCHAR(50),
                    end_time VARCHAR(50),
                    total_usdc NUMERIC,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            CREATE TABLE IF NOT EXISTS batch_transactions (
                    id SERIAL PRIMARY KEY,
                    batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
                    wallet_address VARCHAR(100),
                    amount_usdc NUMERIC,
                    tx_hash VARCHAR(100),
                    status VARCHAR(20) DEFAULT 'PENDING'
                );
        `);
        client.release();
        res.send("<h1>✅ Tablas de Lotes actualizadas.</h1>");
    } catch (err) {
        res.status(500).json(err);
    }
});

// ... (API Endpoints: USUARIOS y CURSOS sin cambios) ...
// ... (API Endpoints: TRANSACCIONES sin cambios) ...

// --- API Endpoints: GESTIÓN DE LOTES ---

// POST: Crear nuevo Lote (Cabecera)
app.post('/api/batches', async (req, res) => {
    const { batch_number, detail, description, scheduled_date, start_time, end_time, total_usdc } = req.body;
    try {
        const query = `
            INSERT INTO batches (batch_number, detail, description, scheduled_date, start_time, end_time, total_usdc) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
        `;
        const values = [batch_number, detail, description, scheduled_date, start_time, end_time, total_usdc];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Subir Excel para un Lote
app.post('/api/batches/:id/upload', upload.single('file'), async (req, res) => {
    const batchId = req.params.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        // Leer archivo Excel
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        // Validar e insertar registros
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const row of data) {
                // Mapear columnas del Excel según imagen del usuario
                // "Address Wallet", "USDC", "Hash"
                const wallet = row['Address Wallet'];
                const amount = row['USDC'];
                const hash = row['Hash'] || '';

                if (wallet && amount) {
                    await client.query(
                        `INSERT INTO batch_transactions (batch_id, wallet_address, amount_usdc, tx_hash) VALUES ($1, $2, $3, $4)`,
                        [batchId, wallet, amount, hash]
                    );
                }
            }

            await client.query('COMMIT');

            // Eliminar archivo temporal
            fs.unlinkSync(req.file.path);

            // Devolver las transacciones creadas para mostrarlas
            const result = await client.query('SELECT * FROM batch_transactions WHERE batch_id = $1', [batchId]);
            res.json({ message: 'Lote procesado exitosamente', count: data.length, transactions: result.rows });
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

// Fallback, etc...


// ... (API Endpoints: USUARIOS y CURSOS sin cambios) ...

// --- API Endpoints: TRANSACCIONES ---

// GET: Obtener historial
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

// POST: Guardar transacción
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

// --- API Endpoints: USUARIOS ---

// GET: Obtener todos los usuarios
app.get('/api/users', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]); // Modo mock local
        const result = await pool.query('SELECT * FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Crear usuario
app.post('/api/users', async (req, res) => {
    const { nombre, apellido, dni, edad, sexo } = req.body;
    try {
        const query = 'INSERT INTO users (nombre, apellido, dni, edad, sexo) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const values = [nombre, apellido, dni, edad, sexo];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Editar usuario
app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, apellido, dni, edad, sexo } = req.body;
    try {
        const query = 'UPDATE users SET nombre=$1, apellido=$2, dni=$3, edad=$4, sexo=$5 WHERE id=$6 RETURNING *';
        const values = [nombre, apellido, dni, edad, sexo, id];
        const result = await pool.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Borrar usuario
app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id=$1', [id]);
        res.json({ message: "Usuario eliminado" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API Endpoints: CURSOS ---

// GET: Obtener todos los cursos
app.get('/api/courses', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) return res.json([]);
        const result = await pool.query('SELECT * FROM courses ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Crear curso
app.post('/api/courses', async (req, res) => {
    const { nombre, descripcion, nivel, fecha_inicio, duracion_semanas } = req.body;
    try {
        const query = 'INSERT INTO courses (nombre, descripcion, nivel, fecha_inicio, duracion_semanas) VALUES ($1, $2, $3, $4, $5) RETURNING *';
        const values = [nombre, descripcion, nivel, fecha_inicio, duracion_semanas];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT: Editar curso
app.put('/api/courses/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, nivel, fecha_inicio, duracion_semanas } = req.body;
    try {
        const query = 'UPDATE courses SET nombre=$1, descripcion=$2, nivel=$3, fecha_inicio=$4, duracion_semanas=$5 WHERE id=$6 RETURNING *';
        const values = [nombre, descripcion, nivel, fecha_inicio, duracion_semanas, id];
        const result = await pool.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ error: "Curso no encontrado" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE: Borrar curso
app.delete('/api/courses/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM courses WHERE id=$1', [id]);
        res.json({ message: "Curso eliminado" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API Endpoints: TRANSACCIONES ---

// GET: Obtener historial
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

// POST: Guardar transacción
app.post('/api/transactions', async (req, res) => {
    const { tx_hash, from_address, to_address, amount } = req.body;
    try {
        const query = 'INSERT INTO transactions (tx_hash, from_address, to_address, amount) VALUES ($1, $2, $3, $4) RETURNING *';
        const values = [tx_hash, from_address, to_address, amount.toString()];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Fallback para SPA (si fuera necesario router frontend, pero aquí es simple)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
