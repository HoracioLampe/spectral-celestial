---
name: powershell-windows-patterns
description: Critical patterns and pitfalls for running scripts on Windows PowerShell. Use when writing or executing any PowerShell script, especially with logical operators, file paths, JSON, arrays, or Unicode characters.
---

# PowerShell Windows Patterns

## 1. Operator Syntax — CRÍTICO: Paréntesis obligatorios

Cada cmdlet dentro de un operador lógico DEBE ir entre paréntesis:

```powershell
# ❌ MAL
if (Test-Path "a" -or Test-Path "b") { ... }

# ✅ BIEN
if ((Test-Path "a") -or (Test-Path "b")) { ... }
if ((Get-Item $x) -and ($y -eq 5)) { ... }
```

## 2. Unicode/Emoji — CRÍTICO: Solo ASCII en scripts

| Propósito | ❌ NO usar | ✅ Usar |
|---|---|---|
| Éxito | ✅ ✓ | `[OK]` `[+]` |
| Error | ❌ 🔴 | `[!]` `[X]` |
| Warning | ⚠️ 🟡 | `[*]` `[WARN]` |
| Info | ℹ️ 🔵 | `[i]` `[INFO]` |
| Progreso | ⏳ | `[...]` |

**Regla:** Scripts PowerShell con Unicode/emoji fallan con "Unexpected token".

## 3. Null Checks — Siempre verificar antes de acceder

```powershell
# ❌ MAL
$array.Count -gt 0
$text.Length

# ✅ BIEN
$array -and $array.Count -gt 0
if ($text) { $text.Length }
```

## 4. String Interpolation — Expresiones complejas

```powershell
# ❌ MAL (puede fallar)
"Value: $($obj.prop.sub)"

# ✅ BIEN — guardar en variable primero
$value = $obj.prop.sub
Write-Output "Value: $value"
```

## 5. Error Handling

| `$ErrorActionPreference` | Usar cuando |
|---|---|
| `Stop` | Desarrollo (fail fast) |
| `Continue` | Scripts de producción |
| `SilentlyContinue` | Cuando se esperan errores |

```powershell
try {
    # lógica
    Write-Output "[OK] Done"
    # NO hacer return dentro del try
}
catch {
    Write-Warning "Error: $_"
    exit 1
}
finally {
    # limpieza siempre aquí
}
# return DESPUÉS del try/catch
```

## 6. File Paths

```powershell
# Literal
C:\Users\User\file.txt

# Variable — usar Join-Path
Join-Path $env:USERPROFILE "file.txt"
Join-Path $ScriptDir "data"
```

**Regla:** Siempre usar `Join-Path` para seguridad multiplataforma.

## 7. Arrays

```powershell
$array = @()           # array vacío
$array += $item        # agregar item
[void]$list.Add($item) # ArrayList
```

## 8. JSON — CRÍTICO: Siempre especificar -Depth

```powershell
# ❌ MAL
ConvertTo-Json $obj

# ✅ BIEN
ConvertTo-Json $obj -Depth 10

# Leer/escribir archivos
$data = Get-Content "file.json" -Raw | ConvertFrom-Json
$data | ConvertTo-Json -Depth 10 | Set-Content "file.json"
```

## 9. Errores Comunes

| Mensaje de error | Causa | Fix |
|---|---|---|
| `"parameter 'or'"` | Faltan paréntesis | Envolver cmdlets en `()` |
| `"Unexpected token"` | Carácter Unicode | Solo ASCII |
| `"Cannot find property"` | Objeto null | Verificar null primero |
| `"Cannot convert"` | Tipo incorrecto | Usar `.ToString()` |
| `"&& no es separador"` | PowerShell no soporta `&&` | Usar `;` o dos comandos separados |

## 10. Template Base

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

try {
    # Logica aqui
    Write-Output "[OK] Done"
    exit 0
}
catch {
    Write-Warning "Error: $_"
    exit 1
}
```
