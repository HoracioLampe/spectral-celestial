---
name: svg-utf8-encoding
description: Pattern for correctly handling UTF-8 encoded SVG certificates through base64 encoding/decoding pipeline. Prevents mojibake (MÃ¡ster → Máster) when serving SVGs via API.
---

# SVG UTF-8 Encoding Pattern

## The Problem

SVG certificates containing non-ASCII characters (á, é, í, ó, ú, ñ, ü, etc.) display as mojibake when served via base64:

```
Expected: Máster en Dirección de Empresas
Got:      MÃ¡ster en DirecciÃ³n de Empresas
```

This happens because of a UTF-8 → Latin-1 → UTF-8 double-encoding bug in the base64 pipeline.

## Root Cause

The bug lives in two places:

### 1. Backend: Wrong read mode
```javascript
// ❌ BAD: Reads as UTF-8 string, then re-encodes to Buffer
const raw = fs.readFileSync(svgPath, 'utf8');          // String (UTF-8 decoded)
svgContent = Buffer.from(raw).toString('base64');       // Re-encodes UTF-8 bytes

// ✅ GOOD: Reads raw bytes, encodes directly to base64
const raw = fs.readFileSync(svgPath);                   // Buffer (raw bytes)
svgContent = raw.toString('base64');                     // Direct base64 of original bytes
```

### 2. Frontend: `atob()` doesn't handle UTF-8
```javascript
// ❌ BAD: atob() treats each byte as a Latin-1 character
__html: atob(base64Content)            // á (2 bytes) → Ã¡ (2 chars)

// ✅ GOOD: TextDecoder properly handles multi-byte UTF-8
__html: new TextDecoder('utf-8').decode(
    Uint8Array.from(atob(base64Content), c => c.charCodeAt(0))
)
```

## Why Both Fixes Are Needed

| Backend Read | Frontend Decode | Result |
|---|---|---|
| `readFileSync('utf8')` + `Buffer.from()` | `atob()` | ❌ MÃ¡ster |
| `readFileSync('utf8')` + `Buffer.from()` | `TextDecoder` | ✅ Máster |
| `readFileSync()` (binary) | `atob()` | ❌ MÃ¡ster |
| `readFileSync()` (binary) | `TextDecoder` | ✅ Máster |

The safest combination is **binary read + TextDecoder** because:
- Binary read preserves the exact bytes without any string conversion
- TextDecoder correctly interprets multi-byte UTF-8 sequences

## SVG XML Header for Portability

Always include the UTF-8 encoding declaration in generated SVGs:

```javascript
// Before saving SVG
if (!svgContent.startsWith('<?xml')) {
    svgContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgContent;
}
fs.writeFileSync(svgPath, svgContent, 'utf8');
```

### Safety: Won't Double-Add

The `startsWith('<?xml')` guard prevents adding the header twice. If the SVG template was exported from Illustrator/Inkscape and already has `<?xml version="1.0" encoding="UTF-8"?>`, the check returns `true` and skips the prepend. This is idempotent — safe to run on any SVG regardless of whether it already has the declaration.

This ensures the SVG renders correctly when:
- Opened directly in a browser
- Downloaded and opened in Illustrator/Inkscape
- Viewed from IPFS gateway
- Embedded in other HTML documents

## Patching Existing SVGs

To add the XML header to all existing SVGs:

```javascript
// _patch_svgs.mjs
import { promises as fs } from 'fs';
import path from 'path';

async function patchSVGs(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await patchSVGs(full);
        } else if (entry.name.endsWith('.svg')) {
            const content = await fs.readFile(full, 'utf8');
            if (!content.startsWith('<?xml')) {
                const patched = '<?xml version="1.0" encoding="UTF-8"?>\n' + content;
                await fs.writeFile(full, patched, 'utf8');
                console.log(`✅ Patched: ${full}`);
            }
        }
    }
}

await patchSVGs('./uploads/certificates');
```

## Key Takeaway

When transferring binary data (like UTF-8 text files) through a JSON API via base64:
- **Encode**: Read as raw bytes → `.toString('base64')`
- **Decode**: `atob()` → `Uint8Array` → `TextDecoder('utf-8')`

Never use `atob()` alone for text that may contain non-ASCII characters.
