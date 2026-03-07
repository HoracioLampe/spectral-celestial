---
name: UUPS Smart Contract Upgrade
description: Patrón completo para upgradear contratos UUPS upgradeable en Polygon desde la UI de Contract Admin. Usar cuando se necesita deployar una nueva implementación y aplicar el upgrade al proxy. Cubre: compilación, deploy de la nueva impl via MetaMask, y la TX de upgradeToAndCall.
---

# UUPS Smart Contract Upgrade Pattern

## Contexto

El contrato InstantPayment usa el patrón **UUPS (EIP-1967)**:
- **Proxy** (address fijo, no cambia nunca): `0x971da9d642C94f6B5E3867EC891FBA7ef8287d29`
- **Implementation** (cambia con cada upgrade): desplegada por separado
- El proxy delega todas las llamadas a la implementación via `delegatecall`

Solo el **owner** puede llamar `upgradeToAndCall`.

---

## Flujo Completo de Upgrade

### Paso 0 — Compilar el contrato

```bash
npx hardhat compile
```

Esto genera `artifacts/contracts/InstantPaymentV2.sol/InstantPaymentV2.json` con el bytecode.

### Paso 1 — Deploy de la nueva implementación

El botón **upgradeToAndCall(V2)** en Contract Admin hace esto automáticamente:

1. Llama `GET /api/v1/instant/admin/v2-bytecode` → obtiene el bytecode compilado
2. Envía una TX de deploy via MetaMask (el owner firma, paga gas)
3. Lee `deployReceipt.contractAddress` → nueva impl address

### Paso 2 — Upgrade del proxy

Con el nuevo impl address, el botón llama:

```solidity
proxy.upgradeToAndCall(newImplAddress, "0x", { gasLimit: 300000 })
```

El owner firma en MetaMask. El proxy apunta a la nueva implementación desde ese momento.

---

## Archivos Involucrados

| Archivo | Rol |
|---------|-----|
| `contracts/InstantPaymentV2.sol` | Nueva implementación |
| `artifacts/.../InstantPaymentV2.json` | Bytecode compilado |
| `server.js` → `GET /api/v1/instant/admin/v2-bytecode` | Sirve el bytecode |
| `public/app.js` → `cadUpgradeToV2()` | UI: deploy + upgrade |
| `public/index.html` → Contract Admin panel | Botón upgradeToAndCall(V2) |

---

## Reglas de Seguridad del Contrato

```solidity
function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
```

Solo el **owner** puede upgradar. El guard está en el contrato mismo.

---

## Cuando Agregar Nuevas Funciones a la Implementación

1. Editar `contracts/InstantPaymentV2.sol` (agregar funciones o modificar existentes)
2. **NO agregar nuevas variables de estado** sin reducir `uint256[44] private __gap` (storage collision risk)
3. Compilar: `npx hardhat compile`
4. Hacer el upgrade desde Contract Admin (botón `upgradeToAndCall(V2)`)

---

## Notes

- El bytecode endpoint (`/v2-bytecode`) solo es accesible para `SUPER_ADMIN`
- El deploy de la implementación lo paga el **owner** (cold wallet via MetaMask)
- La implementación no tiene estado propio — el estado vive en el proxy storage
- `version()` en el contrato retorna `"2.0.0"` para verificar que el upgrade fue exitoso
