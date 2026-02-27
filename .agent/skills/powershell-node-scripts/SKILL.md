---
name: powershell-node-scripts
description: How to run inline Node.js ESM scripts on Windows PowerShell without double-quote escaping issues. Use this whenever you need to execute quick Node.js one-liners or database queries from the terminal.
---

# PowerShell + Node.js Script Execution

## The Problem

PowerShell does not handle double-quoted strings inside `node -e "..."` well. Nested double quotes cause parse errors like:

```
SyntaxError: missing ) after argument list
```

Also, PowerShell's `""` escape for inner double quotes doesn't always work with `node -e`.

## The Solution: Use a Temp `.mjs` Script File

Instead of fighting PowerShell quoting, write a temporary `.mjs` file and execute it:

### Step 1: Write the script
```javascript
// _temp_query.mjs
import db from './backend/config/database.js';

const r = await db.query('SELECT DISTINCT status FROM certificates');
console.table(r.rows);
process.exit(0);
```

### Step 2: Run it
```bash
node _temp_query.mjs
```

### Step 3: Clean up (optional)
Delete the temp file after use.

## When `--input-type=module` Works

For **simple queries with no double quotes** in the SQL, you CAN use inline:

```bash
node --input-type=module -e "import db from './backend/config/database.js'; const r = await db.query('SELECT NOW()'); console.log(r.rows); process.exit(0);"
```

Key rule: The outer wrapper uses `"`, so all internal strings must use `'` single quotes.

## When You MUST Use a File

- SQL contains double quotes or special characters
- Multi-line queries
- Complex logic with template literals
- Any string containing `$` (PowerShell interpolates it)

## Naming Convention

Use `_temp_*.mjs` or `_check_*.mjs` prefix so they're easy to find and clean up. Add them to `.gitignore` if needed.

## Common Patterns

### Database Query
```javascript
// _temp_query.mjs
import db from './backend/config/database.js';
const r = await db.query(`SELECT * FROM certificates WHERE tenant_id = $1 LIMIT 5`, ['uuid-here']);
console.table(r.rows);
process.exit(0);
```

### Run SQL Migration File
```javascript
// _temp_migrate.mjs  
import db from './backend/config/database.js';
import fs from 'fs';
const sql = fs.readFileSync('./backend/migrations/my_migration.sql', 'utf8');
await db.query(sql);
console.log('Migration OK');
process.exit(0);
```

### Check Table Structure
```javascript
// _temp_schema.mjs
import db from './backend/config/database.js';
const r = await db.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'certificates'
    ORDER BY ordinal_position
`);
console.table(r.rows);
process.exit(0);
```
