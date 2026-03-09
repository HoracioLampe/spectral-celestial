# Smart Contract Engineer - Validations

## External Call Before State Update

### **Id**
reentrancy-risk
### **Severity**
error
### **Type**
regex
### **Pattern**
  - call\{value.*balances\[.*\].*=
  - transfer\(.*amount.*balances.*=
  - send\(.*balance.*=
### **Message**
External call before state update - reentrancy risk.
### **Fix Action**
Update state BEFORE external calls (checks-effects-interactions)
### **Applies To**
  - **/*.sol

## Using tx.origin for Auth

### **Id**
tx-origin
### **Severity**
error
### **Pattern**
  - tx\\.origin
### **Message**
tx.origin is vulnerable to phishing attacks.
### **Fix Action**
Use msg.sender for authentication
### **Applies To**
  - **/*.sol

## Floating Pragma Version

### **Id**
floating-pragma
### **Severity**
warning
### **Pattern**
  - pragma solidity \^
### **Message**
Floating pragma may compile with different versions.
### **Fix Action**
Lock to specific version: pragma solidity 0.8.20
### **Applies To**
  - **/*.sol

## Unchecked External Call Return

### **Id**
unchecked-return
### **Severity**
error
### **Pattern**
  - \\.call\\{.*\\}\\([^)]*\\);(?!\\s*if)
### **Message**
External call return value not checked.
### **Fix Action**
Check return: (bool success, ) = ...; require(success);
### **Applies To**
  - **/*.sol

## Missing Access Control

### **Id**
missing-access-control
### **Severity**
error
### **Pattern**
  - function.*external(?!.*onlyOwner|.*onlyRole|.*require\\(msg\\.sender)
### **Message**
State-changing function may be missing access control.
### **Fix Action**
Add onlyOwner or role-based access control
### **Applies To**
  - **/*.sol

## Unbounded Loop

### **Id**
unbounded-loop
### **Severity**
warning
### **Pattern**
  - for.*\\.length
### **Message**
Unbounded loop may exceed gas limit.
### **Fix Action**
Add iteration limits or use pagination
### **Applies To**
  - **/*.sol

## Block Timestamp Manipulation

### **Id**
block-timestamp-dependence
### **Severity**
info
### **Pattern**
  - block\\.timestamp.*[<>]
### **Message**
block.timestamp can be manipulated by miners (~15 seconds).
### **Fix Action**
Don't use for critical timing within short windows
### **Applies To**
  - **/*.sol
