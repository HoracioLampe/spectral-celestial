// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Mock USDC for testing InstantPayment.
 *      Allows controlling the return value of transferFrom
 *      and the allowance reported to the contract.
 */
contract MockUSDC {
    bool private _transferReturnValue;
    uint256 private _allowance;

    constructor(bool returnValue) {
        _transferReturnValue = returnValue;
        _allowance = type(uint256).max; // unlimited by default
    }

    /// @dev Set whether transferFrom succeeds or fails
    function setReturnValue(bool returnValue) external {
        _transferReturnValue = returnValue;
    }

    /// @dev Set the allowance this mock reports
    function setAllowance(uint256 amount) external {
        _allowance = amount;
    }

    // ── ERC-20 + ERC-2612 minimal interface ──────────────────────────────────

    function transferFrom(address, address, uint256) external returns (bool) {
        return _transferReturnValue;
    }

    function allowance(address, address) external view returns (uint256) {
        return _allowance;
    }

    function permit(
        address, address, uint256, uint256, uint8, bytes32, bytes32
    ) external pure {
        // No-op for tests
    }
}
