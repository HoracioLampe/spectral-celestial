require('dotenv').config();
const { Pool } = require('pg');

async function inspect() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const target = process.argv[2];
    if (!target) {
        console.error("Please provide an address");
        return;
    }
    console.log(`Inspecting Relayer: ${target}`);
    const res = await pool.query(`
        SELECT r.*, b.status as batch_status, b.batch_number, b.description 
        FROM relayers r
        JOIN batches b ON r.batch_id = b.id 
        WHERE r.address = $1
    `, [target]);

    if (res.rows.length === 0) {
        console.log("Relayer NOT FOUND in database.");
    } else {
        console.log(res.rows[0]);
    }
    await pool.end();
}

inspect();
