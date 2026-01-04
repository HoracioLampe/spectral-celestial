require('dotenv').config();
const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL;

console.log("---------------------------------------------------");
console.log("🧪 Testing Database Connection...");
console.log(`URL: ${dbUrl ? dbUrl.replace(/:[^:@]*@/, ':****@') : 'UNDEFINED'}`);
console.log("---------------------------------------------------");

if (!dbUrl) {
    console.error("❌ ERROR: DATABASE_URL is not defined in .env");
    process.exit(1);
}

const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
});

(async () => {
    try {
        const client = await pool.connect();
        console.log("✅ Connection Successful!");

        const res = await client.query('SELECT NOW() as now');
        console.log(`🕒 Server Time: ${res.rows[0].now}`);

        const resTables = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
        console.log(`📊 Table Count: ${resTables.rows[0].count}`);

        client.release();
        await pool.end();
        console.log("---------------------------------------------------");
        process.exit(0);
    } catch (err) {
        console.error("❌ Connection Failed:", err.message);
        console.log("---------------------------------------------------");
        console.error("Possible causes:");
        console.error("1. IP Address not whitelisted (if using cloud DB)");
        console.error("2. Incorrect credentials");
        console.error("3. Database is sleeping/hibernated");
        process.exit(1);
    }
})();
