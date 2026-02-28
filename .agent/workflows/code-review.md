---
description: correr el code reviewer sobre los archivos modificados desde el último commit
---

# Code Review Pre-Push

Ejecutar este workflow antes de hacer `git push` a `dev` o `main` para detectar problemas.

## Pasos

1. Ver los archivos que cambiaron en el último commit:
```bash
git diff HEAD~1 HEAD --name-only
```

2. Correr el skill `code-reviewer` sobre los archivos modificados de las categorías:
   - `public/*.js` — JavaScript frontend
   - `server.js` o `services/*.js` — Backend Node.js
   - `contracts/*.sol` — Smart contracts Solidity

3. Por cada archivo revisado, generar la tabla de problemas según el skill (tipo, línea, corrección).

4. Si hay issues de severidad 🔴 crítico → NO hacer push hasta resolverlos.

5. Si solo hay 🟠 o 🟡 → Documentarlos en el reporte y hacer push.

6. Actualizar `code_review_report.md` en el directorio de artifacts con los hallazgos.

## Nota sobre automatización

**No activar en cada push automáticamente** — el review completo es intensivo.
Correrlo manualmente con `/code-review` antes de releases importantes o cuando se toquen archivos críticos (auth, smart contracts, rutas de API).
