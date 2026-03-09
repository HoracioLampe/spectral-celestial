---
name: PostgreSQL Railway Connection
description: Robust pattern for connecting Node.js/Express applications to PostgreSQL on Railway with intelligent SSL handling and environment variable cleaning.
---

# PostgreSQL Railway Connection

This skill provides a battle-tested pattern for connecting to PostgreSQL on Railway, overcoming common issues like SSL handshake failures on internal networks and malformed environment variables.

## Core Features
1.  **SSL Intelligence**: Automatically handles Railway's requirement for `{ rejectUnauthorized: false }` in production, even when using `.internal` URLs which often cause connection timeouts otherwise.
2.  **Environment Sanitization**: Removes potential wrapping quotes (`"` or `'`) from Railway's environment variables to prevent malformed connection strings.
3.  **Unified Architecture Support**: Works seamlessly in both multi-service and unified (monolith) deployments.
4.  **Connection Pooling**: Pre-configured with robust timeout and pool size settings suitable for Merkle tree operations and high concurrency.

## Implementation Guide

### 1. Unified `database.js` Pattern

Save this file in `backend/config/database.js`:

```javascript
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded correctly for both local and production environments
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

const { Pool } = pg;

/**
 * Utility to clean environment variables (removes quotes and whitespace)
 */
const getCleanEnv = (key, defaultValue = '') => {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.replace(/^["']|["']$/g, '').trim();
};

const NODE_ENV = getCleanEnv('NODE_ENV', 'development');
const DATABASE_URL = getCleanEnv('DATABASE_URL');
const isProduction = NODE_ENV === 'production';

console.log(`📡 DB Config: Env=${NODE_ENV}, hasURL=${!!DATABASE_URL}`);

// The "Standard Railway Fix":
// Unconditional SSL with rejectUnauthorized: false in production
const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

const poolConfig = DATABASE_URL 
  ? { 
      connectionString: DATABASE_URL,
      ssl: sslConfig
    }
  : {
      host: getCleanEnv('DB_HOST', 'localhost'),
      port: parseInt(getCleanEnv('DB_PORT', '5432')),
      database: getCleanEnv('DB_NAME', 'test_db'),
      user: getCleanEnv('DB_USER', 'postgres'),
      password: getCleanEnv('DB_PASSWORD', 'password'),
      ssl: sslConfig
    };

const dbConfig = {
  ...poolConfig,
  max: 30, 
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(dbConfig);

export const query = (text, params) => pool.query(text, params);
export const testConnection = async () => {
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch (err) {
    console.error('❌ Connection error:', err.message);
    return false;
  }
};

export default pool;
```

### 2. Required Dependencies
```bash
npm install pg dotenv
```

### 3. Production Deployment Notes
- **SSL**: Railway usually requires `rejectUnauthorized: false` for external connections. For internal connections (`.internal`), while some docs suggest disabling SSL, passing the object with `false` rejection is the most robust way to ensure the handshake completes.
- **Port**: Always use `process.env.PORT || 3001` for the backend and ensure the frontend (if unified) uses relative paths (`/api`).
