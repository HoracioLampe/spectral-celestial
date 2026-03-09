---
name: hardhat-solidity-setup
description: >
  Patrones y soluciones para configurar Hardhat correctamente con OpenZeppelin v5
  y contratos UUPS upgradeables. Usarlo cuando hay errores de compilación HH606,
  problemas de pragma, o al preparar upgrades de contratos.
---

# Hardhat + OpenZeppelin v5 — Patrones Correctos

## Problema Común: HH606 — Pragma Version Mismatch

### Causa
OpenZeppelin v5 usa pragmas `^0.8.21` y `^0.8.22` en sus contratos internos.
Si tu contrato tiene `pragma solidity 0.8.20` (fijo, sin `^`), Hardhat no puede compilar porque requiere que un contrato y **todos sus imports** usen el mismo compilador.

### Error típico
```
Error HH606: contracts/MyContract.sol (0.8.20) imports
@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol (^0.8.22)
```

### Solución definitiva

**1. Pragma: usar rango en lugar de versión fija**
```solidity
// ❌ Fijo — incompatible con OZ v5
pragma solidity 0.8.20;

// ✅ Rango — compatible con OZ v5 y Hardhat 0.8.26
pragma solidity ^0.8.20;
```

**2. hardhat.config.cjs: compilador único 0.8.26**
```javascript
module.exports = {
    solidity: {
        version: '0.8.26',          // Máxima versión soportada por HH 2.22.x
        settings: {                  // Satisface ^0.8.20, ^0.8.21, ^0.8.22
            optimizer: { enabled: true, runs: 200 },
        },
    },
    networks: {
        polygon: {
            url: process.env.RPC_URL_1,
            chainId: 137,
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            gasPrice: 'auto',
        },
    },
};
```

> **NUNCA** usar `compilers: []` multi-versión para este caso — Hardhat requiere que
> un contrato y todos sus imports usen el MISMO compilador seleccionado.

---

## Versiones Soportadas en Hardhat 2.22.x

| Versión Solidity | Hardhat 2.22.x |
|-----------------|----------------|
| 0.8.20 | ✅ Soportado |
| 0.8.24 | ✅ Soportado |
| 0.8.26 | ✅ Soportado (máximo recomendado) |
| 0.8.27 | ⚠️ Parcial |
| 0.8.28 | ❌ No soportado |

---

## Reglas para Contratos UUPS Upgradeables

### Pragma
- Usar `^0.8.20` (nunca fijo en proyectos con OZ v5)
- El compilador elegido debe satisfacer el rango de TODOS los imports

### Storage Layout (crítico)
```solidity
// ✅ Siempre incluir storage gap
uint256[44] private __gap;  // Reservar slots para V2+

// Al agregar variable de estado en upgrade:
uint256[43] private __gap;  // Reducir en 1 por cada nueva variable
uint256 public nuevaVariable; // Nueva variable en V2
```

### Custom Errors vs require strings
```solidity
// ❌ Más gas, inconsistente
require(condition, "error message");

// ✅ Menos gas, patrón moderno
error NombreDelError();
if (!condition) revert NombreDelError();
```

---

## Flujo de Upgrade UUPS

```bash
# 1. Compilar (verificar que no hay errores)
npx hardhat compile

# 2. Deployar nueva implementación (NO toca el proxy)
npx hardhat run scripts/upgrade.js --network polygon

# 3. El script llama internamente:
#    await upgrades.upgradeProxy(PROXY_ADDRESS, NewImplementationFactory);
```

### Script tipo upgrade.js
```javascript
const { ethers, upgrades } = require('hardhat');

async function main() {
    const PROXY = process.env.PROXY_ADDRESS;
    const NewImpl = await ethers.getContractFactory('InstantPayment');
    
    console.log('Upgrading proxy at:', PROXY);
    const upgraded = await upgrades.upgradeProxy(PROXY, NewImpl);
    await upgraded.waitForDeployment();
    
    console.log('New implementation:', await upgrades.erc1967.getImplementationAddress(PROXY));
}

main().catch(console.error);
```

---

## Checklist antes de hacer upgrade

- [ ] `npx hardhat compile` pasa sin errores
- [ ] No se reordenaron variables de estado
- [ ] `__gap` reducido correctamente si se agregaron variables
- [ ] Nueva función de estado emite evento
- [ ] `initialize()` tiene `initializer` modifier (no re-llamable)
- [ ] `_authorizeUpgrade` protegida con `onlyOwner`
