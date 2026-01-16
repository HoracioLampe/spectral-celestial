const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:mYWKriiIoggzUBmIzVywdMXRYKNKzOYa@shortline.proxy.rlwy.net:51507/railway",
});

async function addTrigger() {
    const client = await pool.connect();
    try {
        console.log("Configurando Trigger de Auto-Update...");

        // 1. Create the function (idempotent due to OR REPLACE)
        await client.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
               NEW.updated_at = NOW();
               RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);
        console.log("✅ Función 'update_updated_at_column' creada.");

        // 2. Drop trigger if exists to avoid conflicts/duplication during dev
        await client.query(`DROP TRIGGER IF EXISTS update_batches_updated_at ON batches;`);

        // 3. Create Trigger for 'batches'
        await client.query(`
            CREATE TRIGGER update_batches_updated_at
            BEFORE UPDATE ON batches
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `);
        console.log("✅ Trigger 'update_batches_updated_at' activado.");

        // Optional: Add for 'batch_transactions' too if it has the column
        // We know from diagnostic checks it does have 'updated_at'
        await client.query(`DROP TRIGGER IF EXISTS update_transactions_updated_at ON batch_transactions;`);
        await client.query(`
            CREATE TRIGGER update_transactions_updated_at
            BEFORE UPDATE ON batch_transactions
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        `);
        console.log("✅ Trigger 'update_transactions_updated_at' activado.");

    } catch (err) {
        console.error("❌ Error configurando trigger:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

addTrigger();
