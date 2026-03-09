---
name: utf8-mojibake-fix
description: Pattern for correcting UTF-8 strings that have been erroneously interpreted as Latin-1 (Mojibake). Fixes characters like "Ã³" returning to "ó" in filenames, user inputs, and database records.
---

# UTF-8 Mojibake Fix Pattern

## The Problem

When a UTF-8 string (like "José") is read or interpreted as ISO-8859-1 (Latin-1), each byte of the multi-byte UTF-8 character is treated as a separate character. This results in "Mojibake" (garbled text).

**Example:**
- Original: `José` (UTF-8 bytes: `4A 6F 73 C3 A9`)
- Read as Latin-1: `JosÃ©`
  - `C3` -> `Ã`
  - `A9` -> `©`

This often happens with:
- Filesystems (especially on Windows/Linux cross-platform operations)
- ZIP/TAR extraction where encoding flags are missing
- Database drivers with incorrect collation/charset settings
- Legacy API integrations

## The Solution

To fix this **without re-fetching the data source**, you can reverse the wrong decoding by:
1. Converting the "Mojibake" string back to its original binary bytes (treating it as binary/Latin-1).
2. Re-interpreting those valid bytes as UTF-8.

### JavaScript / Node.js Helper

```javascript
/**
 * Helper to fix UTF-8 strings erroneously encoded as Latin-1 (Mojibake)
 * e.g. "EspecificaciÃ³n" -> "Especificación"
 */
function fixEncoding(str) {
    if (!str) return str;
    
    try {
        // detection: Check if string has common UTF-8 artifacts (Ã, Â, etc.)
        // This prevents double-fixing strings that are already correct.
        if (/[ÃÂ]/.test(str)) {
            return Buffer.from(str, 'binary').toString('utf8');
        }
        return str;
    } catch (e) {
        console.warn('Encoding fix failed for:', str);
        return str;
    }
}
```

### Usage Examples

#### 1. Fixing Filenames in Directory Scans

When using `fs.readdir` or processing uploads where filenames might be corrupted:

```javascript
import fs from 'fs';

const files = fs.readdirSync('/uploads');

const cleanFiles = files.map(filename => ({
    original: filename, // Keep for fs operations
    display: fixEncoding(filename) // Use for UI/JSON response
}));

// Output:
// { original: "MÃ¡ster.pdf", display: "Máster.pdf" }
```

#### 2. Fixing Database Records

If a database column has stored Mojibake (e.g., from a bad import):

```javascript
const user = await db.getUser(id);
const cleanName = fixEncoding(user.name); 

// Note: It's better to fix the data in the DB solely via migration if possible,
// but this helper works for runtime display fixes.
```

#### 3. Fixing API Responses

Apply it in your map functions before sending JSON to the frontend:

```javascript
res.json({
    files: rawFiles.map(f => ({
        ...f,
        name: fixEncoding(f.name)
    }))
});
```

## Why this works

`Buffer.from(str, 'binary')` takes the low-byte of each character in the string. Since the Latin-1 (ISO-8859-1) mapping matches the first 256 Unicode code points, this effectively recovers the original raw bytes of the UTF-8 string.

`.toString('utf8')` then takes those raw bytes and properly decodes them as a multi-byte UTF-8 string.

## Caution

- **Do not apply blindly**: The regex check `/[ÃÂ]/.test(str)` is a heuristic. It's safe for Spanish/Portuguese/French (Latin languages) but might theoretically false-positive on strings that genuinely contain "Ã" followed by "©" in that exact sequence (rare).
- **Persistence**: Usage of this pattern implies the data *at rest* or *on disk* is "corrupted" (or at least stored with a different encoding expectation). For filenames, you must use the **original** (Mojibake) string to access the file on disk, but show the **fixed** string to the user.
