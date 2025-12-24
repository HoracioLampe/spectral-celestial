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
            console.log("✅ Tabla 'users' verificada/creada.");
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ Error conectando a BD:", err);
    }
};
initDB();

// Endpoint de Ayuda: Forzar creación de tabla manualmente
app.get('/setup', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) {
            throw new Error("⚠️ La variable de entorno DATABASE_URL no está definida. \n\nSolución: Ve a Railway -> Variables y asegúrate de que esté ahí, luego Reinicia el servicio.");
        }

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
        `);
        client.release();
        res.send("<h1>✅ Tabla 'users' creada/verificada correctamente.</h1><p>Ya puedes volver atrás y guardar usuarios.</p>");
    } catch (err) {
        res.status(500).send(`
            <h1>❌ Error creando tabla:</h1>
            <p><strong>Mensaje:</strong> ${err.message}</p>
            <pre>${JSON.stringify(err, null, 2)}</pre>
        `);
    }
});

// --- API Endpoints ---

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

// Fallback para SPA (si fuera necesario router frontend, pero aquí es simple)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
