---
name: Solidity Guardian
description: Smart contract security analysis skill. Detect vulnerabilities, suggest fixes, generate audit reports. Supports Hardhat/Foundry projects. Uses pattern matching + best practices from Trail of Bits, OpenZeppelin, and Consensys.
---

# Solidity Guardian 🛡️

Security analysis for Solidity smart contracts. Find vulnerabilities, get fix suggestions, follow best practices.

## Usage

This skill provides automated security analysis capabilities for:
- **Reentrancy attacks**
- **Access control issues**
- **Integer overflow/underflow** (pre-0.8)
- **Unchecked external calls**
- **Timestamp dependence**
- **Front-running vulnerabilities**
- **Gas optimization issues**
- **GDPR compliance patterns**
- **Upgradeability safety** (UUPS, Transparent Proxy)
- **Input validation**

## Security Patterns Detected

### Critical Vulnerabilities
- Reentrancy (external calls before state updates)
- Unprotected selfdestruct
- Delegatecall to untrusted contracts
- Signature replay attacks
- Arbitrary jumps via function types

### High-Risk Issues  
- Missing access control
- Unchecked transfer returns
- tx.origin for authentication
- Weak randomness (block.timestamp/blockhash)
- Unprotected withdrawal functions
- Dangerous equality checks

### Best Practices
- Floating pragma versions
- Missing zero address checks
- Timestamp dependence
- Missing events for state changes
- Magic numbers without constants
- Missing NatSpec documentation

## Audit Methodology

1. **Static Analysis** - Pattern matching for known vulnerabilities
2. **Access Control Review** - Verify all sensitive functions are protected
3. **Input Validation** - Check parameter validation
4. **Storage Layout** - Verify upgradeability safety (if applicable)
5. **Event Tracking** - Ensure critical actions emit events
6. **Gas Optimization** - Identify inefficient patterns

## References

- [Trail of Bits - Building Secure Contracts](https://github.com/crytic/building-secure-contracts)
- [OpenZeppelin - Security Best Practices](https://docs.openzeppelin.com/learn/preparing-for-mainnet)
- [Consensys - Smart Contract Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [SWC Registry](https://swcregistry.io/)
