
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function optimize() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting DB Optimization: Adding Indices for Filters...");

        // Note: We use CREATE INDEX IF NOT EXISTS.
        // Some indices might need to be expression-based for specific queries.

        const indices = [
            // 1. Role/Isolation Filter (Crucial)
            `CREATE INDEX IF NOT EXISTS idx_batches_funder_lower ON batches (LOWER(funder_address))`,

            // 2. Date Filter (Expression Index for DATE(created_at))
            `CREATE INDEX IF NOT EXISTS idx_batches_created_date ON batches ((DATE(created_at)))`,
            // Also standard index for ORDER BY created_at DESC
            `CREATE INDEX IF NOT EXISTS idx_batches_created_at_desc ON batches (created_at DESC)`,

            // 3. Status Filter
            `CREATE INDEX IF NOT EXISTS idx_batches_status ON batches (status)`,

            // 4. Amount Filter (Numeric Range)
            // Casting to numeric happens in query, but indexing the base column helps if we cast commonly
            `CREATE INDEX IF NOT EXISTS idx_batches_total_usdc ON batches (total_usdc)`,

            // 5. Text Search (Description, Detail, Batch Number)
            // Standard indices help with equality or 'prefix%' LIKE queries. 
            // For '%text%', we really need pg_trgm but standard indices are better than nothing for sorting/grouping.
            `CREATE INDEX IF NOT EXISTS idx_batches_batch_number ON batches (batch_number)`,
            `CREATE INDEX IF NOT EXISTS idx_batches_description ON batches (description)`
        ];

        for (const query of indices) {
            console.log(`Executing: ${query}`);
            await client.query(query);
        }

        // Optional: Check if pg_trgm extension exists for better text search
        try {
            await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
            console.log("✅ pg_trgm extension enabled. Adding GIN indices for text search...");

            await client.query('CREATE INDEX IF NOT EXISTS idx_batches_desc_trgm ON batches USING GIN (description gin_trgm_ops)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_batches_detail_trgm ON batches USING GIN (detail gin_trgm_ops)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_batches_number_trgm ON batches USING GIN (batch_number gin_trgm_ops)');

        } catch (e) {
            console.warn("⚠️  Could not enable pg_trgm (might lack permissions). Skipping GIN indices.", e.message);
        }

        console.log("✅ Optimization Complete. Filters should be snappy now.");

    } catch (e) {
        console.error("❌ Optimization Failed:", e.message);
    } finally {
        client.release();
        pool.end();
    }
}

optimize();
