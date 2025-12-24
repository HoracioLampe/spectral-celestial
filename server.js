const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

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
            // Migración segura: Agregar columna si no existe
            await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gas_used VARCHAR(50)`);

            console.log("✅ Tabla 'courses' verificada/creada.");
            console.log("✅ Tabla 'users' verificada/creada.");
            console.log("✅ Tabla 'transactions' verificada/creada + Columna gas_used.");
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
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(100),
                apellido VARCHAR(100),
                dni VARCHAR(20) UNIQUE,
                edad INTEGER,
                sexo VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(150),
                descripcion TEXT,
                nivel VARCHAR(50),
                fecha_inicio DATE,
                duracion_semanas INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                tx_hash VARCHAR(66) UNIQUE NOT NULL,
                from_address VARCHAR(42) NOT NULL,
                to_address VARCHAR(42) NOT NULL,
                amount VARCHAR(50) NOT NULL,
                gas_used VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gas_used VARCHAR(50);
        `);
        client.release();
        res.send("<h1>✅ Tablas actualizadas (incluyendo gas_used).</h1><p>Todo listo.</p>");
    } catch (err) {
        res.status(500).send(`
            <h1>❌ Error creando tablas:</h1>
            <p><strong>Mensaje:</strong> ${err.message}</p>
            <pre>${JSON.stringify(err, null, 2)}</pre>
        `);
    }
});

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
