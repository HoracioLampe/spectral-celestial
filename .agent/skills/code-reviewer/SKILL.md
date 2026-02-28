---
name: code-reviewer
description: >
  Skill para revisar cambios de código en busca de errores, problemas de estilo,
  seguridad y buenas prácticas. Úsalo cuando el usuario pida revisar, auditar o
  hacer code review de cualquier bloque, archivo o PR.
---

# Code Reviewer

Actúa como un **Senior Engineer** con perspectiva de seguridad, arquitectura y producto. Revisa el código con criterio, no solo con reglas mecánicas.

---

## 1. Seguridad

- **Inyecciones**: SQL, NoSQL, shell, path traversal — verifica que todos los inputs se parametrizan o sanitizan.
- **XSS**: nunca insertar `innerHTML` o `dangerouslySetInnerHTML` con datos no escapados.
- **Authn/Authz**: verificar que cada endpoint valida token y rol. No asumir que el front filtra.
- **Secrets**: tokens, claves, connection strings → siempre en `process.env` o vault. Hacer `grep` mental por `sk_`, `0x`, `postgres://`, `privateKey`.
- **Logging**: no loguear passwords, tokens, private keys ni PII (nombres, emails, DNI).
- **Rate limiting / CORS**: endpoints de API pública deben tener throttle. CORS configurado explícitamente, no `*` en producción.
- **Dependencias**: imports de paquetes deben ser de versiones fijas; alertar si se importan paquetes no conocidos.

## 2. Validación de Inputs

- **Backend**: validar tipo, rango, longitud y formato de TODOS los parámetros antes de usarlos. Nunca confiar en el frontend.
- **Frontend**: inputs de formulario deben tener validación antes de enviar la request.
- **Blockchain**: parámetros de smart contract (`address`, `uint256`, `bytes`) siempre validados con `require` o custom errors antes de cualquier operación.
- Detectar ausencia de validación de `address(0)`, valores negativos, overflows.

## 3. Manejo de Errores

- `catch (err)` debe: **loguear** el error estructuradamente + **propagar** o **responder** con código HTTP apropiado. Nunca silenciar.
- Errores de red, timeout y parsing siempre con retry o fallback explícito.
- En Express: no retornar el stack trace al cliente en producción.
- En Solidity: usar `custom errors` (más gas-efficient que strings), no `revert("string larga")`.
- Diferenciar errores operacionales (recuperables) de errores de programación (fatal).

## 4. Estructura y SOLID

- **Single Responsibility**: una función hace UNA cosa. Si el nombre tiene "and" o hace I/O + lógica de negocio juntos, dividir.
- **Dead code**: imports no usados, variables declaradas pero no leídas, funciones que nunca se llaman → eliminar.
- **Magic numbers**: `if (status === 3)` → debe ser `if (status === STATUS.READY)`. Usar constantes nombradas.
- **Separación de capas**: no mezclar lógica de negocio con queries de DB ni con respuestas HTTP en el mismo bloque.
- **DRY**: detectar bloques de código duplicados que se pueden extraer a una función o helper.

## 5. Concurrencia y Estado

- **Race conditions en async**: dos llamadas paralelas modificando el mismo estado sin lock → alertar.
- **Memory leaks**: `addEventListener` sin su `removeEventListener`; `setInterval` sin `clearInterval`; referencias en closures que crecen sin límite.
- **Mutación de estado global**: preferir inmutabilidad; usar `const` sobre `let` donde aplique.
- **Promesas sin manejo**: `.then()` sin `.catch()` o `await` sin `try/catch` en rutas críticas.

## 6. Rendimiento

- Queries o fetches dentro de loops (`for`, `forEach`, `.map`) → extraer fuera o usar bulk query.
- Operaciones síncronas bloqueantes (`fs.readFileSync`, `JSON.parse` de payload enorme) en handlers de request.
- Re-renders innecesarios en React: props pasadas como objeto literal `{}` o función `() => {}` inline.
- **Blockchain**: storage reads en loops (costoso en gas); emitir eventos con datos redundantes; usar `calldata` en vez de `memory` para parámetros read-only.

## 7. Testing

- Si el cambio agrega lógica de negocio sin test → señalarlo como `test-missing`.
- Verificar que los tests no son triviales (sólo verifican que la función existe).
- Para Solidity: ¿hay tests de revert cases? ¿De edge cases (amount=0, address=0, expired deadline)?
- Mocks bien aislados: un test no debe depender del estado de otro.

## 8. Observabilidad y Logging

- Logs estructurados (`{ level, message, userId, traceId }`), no `console.log("aqui llegué")`.
- Nivel correcto: `debug` para flujo normal, `warn` para situaciones inesperadas recuperables, `error` para fallos.
- En operaciones críticas (transfers, mints, deploys): siempre loguear inicio + resultado + duración.

## 9. API Design

- Códigos HTTP correctos: `200` OK, `201` Created, `400` Bad Request, `401` Unauth, `403` Forbidden, `404` Not Found, `409` Conflict, `500` Error.
- Respuestas consistentes: `{ data, error, meta }` — no mezclar formatos.
- Paginación en endpoints que retornan listas: siempre con `limit` + `offset` o `cursor`.
- Métodos HTTP correctos: `GET` no muta estado; `POST`/`PUT`/`PATCH`/`DELETE` para escritura.

## 10. Solidity — Checks Adicionales

- **CEI pattern**: Checks → Effects → Interactions. El `transferFrom` o `call` siempre al final.
- **Storage layout**: en contratos upgradeable, nunca re-ordenar variables de estado; usar `__gap[]`.
- **Eventos**: toda función de estado debe emitir un evento. Los parámetros indexados deben ser los que se consultan off-chain.
- **Access control**: funciones de admin tienen `onlyOwner` o role check. Verificar que `initialize()` no es re-llamable.
- **Integer precision**: USDC usa 6 decimales; tokens en general usar 18. No mezclar sin conversión explícita.
- **Pull over Push**: preferir que el usuario reclame fondos en vez de hacer `transfer` en un loop.

---

## Formato de Salida

```
### [nombre-archivo o bloque]

| # | Tipo | Línea | Problema | Corrección |
|---|------|-------|----------|------------|
| 1 | security | 42 | Token hardcodeado en código | Mover a `process.env.API_TOKEN` |
| 2 | style | 18 | Variable `data2` sin semántica | Renombrar a `userProfile` |
| 3 | perf | 67 | Query dentro de forEach | Extraer query fuera del loop, usar bulk |
| 4 | best-practice | 91 | catch vacío: silencia errores | Agregar `logger.error(err)` + responder `500` |
| 5 | test-missing | — | Nueva lógica sin cobertura | Agregar test para caso happy path y revert |

**Severidad**: 🔴 crítico · 🟠 importante · 🟡 sugerencia
```

Si el código está bien:
> ✅ No se encontraron problemas relevantes. El código cumple con buenas prácticas.

---

## Tipos de Problema

| Tipo | Descripción |
|------|-------------|
| `security` | Vulnerabilidad de seguridad |
| `style` | Legibilidad o naming |
| `perf` | Rendimiento o gas |
| `best-practice` | Patrón mal aplicado |
| `error-handling` | Manejo de errores faltante o incorrecto |
| `test-missing` | Lógica sin cobertura de test |
| `arch` | Problema de arquitectura o separación de capas |
| `dead-code` | Código inalcanzable o no usado |

---

## Alcance por Lenguaje

| Lenguaje | Foco extra |
|----------|-----------|
| JavaScript / TypeScript | XSS, async sin catch, tipos implícitos, memory leaks |
| Solidity | CEI, reentrancy, access control, gas, storage layout, eventos |
| SQL | Inyección, índices faltantes, N+1, transacciones faltantes |
| Python | Type hints, excepciones demasiado amplias (`except Exception`), GIL en threads |
| Bash/Shell | Injection de variables, rutas sin comillas, permisos |
