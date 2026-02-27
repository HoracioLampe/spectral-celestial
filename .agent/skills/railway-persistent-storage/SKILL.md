---
name: Railway Persistent Storage
description: Best practices for handling persistent data volumes on Railway without hardcoding paths.
---

# Railway Persistent Storage Pattern

When using Railway Volumes for persistent data (like uploads, avatars, or certificates), NEVER hardcode relative paths in your static file serving or file manipulation logic. Instead, always use a centralized storage configuration that respects the `UPLOAD_DIR` environment variable.

## Centralized Storage Configuration

Create a `storage.js` config file that dynamically determines the base storage directory:

```javascript
// backend/config/storage.js
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Priority:
// 1. Process environment variable (Absolute path for Railway Volume)
// 2. Local development fallback (Relative path to uploads folder)
const BASE_STORAGE_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');

const storageConfig = {
    baseDir: BASE_STORAGE_DIR,
    // ... helper methods like getTenantDir(tenantId), etc.
};

export default storageConfig;
```

## Static File Serving

In your `server.js`, avoid using `path.join(__dirname, '..', 'uploads')`. Use the `storageConfig.baseDir` instead:

```javascript
// backend/server.js
import storageConfig from './config/storage.js';

// GOOD: Works locally and on Railway with Volumes
app.use('/uploads', express.static(storageConfig.baseDir));

// BAD: Will 404 on Railway if volume is mounted at a different path
// app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
```

## Benefits
- **Portability**: The same code works across local development, staging, and production.
- **Reliability**: Prevents 404 errors when moving files to persistent storage.
- **Maintainability**: Centralized directory management makes it easy to change storage locations.
