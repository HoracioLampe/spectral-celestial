require('dotenv').config();
const { Pool } = require('pg');

async function inspect() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    const targetId = process.argv[2];
    if (!targetId) {
        console.error("Please provide a relayer ID");
        await pool.end();
        return;
    }
    console.log(`Inspecting Relayer ID: ${targetId}`);
    try {
        const res = await pool.query(`
            SELECT r.id as relayer_id, r.address, r.batch_id, b.status as batch_status, b.batch_number, b.description 
            FROM relayers r
            LEFT JOIN batches b ON r.batch_id = b.id 
            WHERE r.id = $1
        `, [targetId]);

        if (res.rows.length === 0) {
            console.log("Relayer NOT FOUND in database.");
        } else {
            console.log("Found Relayer:");
            console.log(res.rows[0]);
        }
    } catch (err) {
        console.error("Error executing query:", err);
    }
    await pool.end();
}

inspect();
