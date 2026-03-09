---
name: push-to-dev
description: >
  Protocolo obligatorio para pushear cambios a la rama dev de spectral-celestial.
  USAR SIEMPRE que se vayan a commitear y pushear cambios. Garantiza que el code
  review se corre antes de cada push, evitando mandar bugs a Railway.
---

# Push to Dev — Protocolo Obligatorio

> **IMPORTANTE:** Este skill debe ejecutarse **completo** en cada push a `dev`, sin saltear pasos.

## Pasos

### 1. Ver qué cambió
```powershell
git status
git diff --stat HEAD
```
Revisar los archivos modificados para tener contexto antes del review.

---

### 2. Correr el code reviewer
Invocar el skill `/code-review` sobre los archivos modificados desde el último commit.

Este paso es **obligatorio** — no hacer push sin haber revisado los cambios.

---

### 3. Stagear los cambios
```powershell
git add -A
```

---

### 4. Commitear con mensaje descriptivo
El mensaje debe seguir el formato:
```
<type>: <descripción corta en inglés>
```
Tipos válidos: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

```powershell
git commit -m "<type>: <descripción>"
```

---

### 5. Push a dev
```powershell
git push origin dev
```
Railway detecta el push automáticamente y deploya.

---

## Reglas

- **Nunca** hacer push directo sin el code review del paso 2.
- Si el code review detecta bugs críticos, corregirlos antes de continuar.
- Usar siempre la rama `dev`, nunca pushear directo a `main`.
