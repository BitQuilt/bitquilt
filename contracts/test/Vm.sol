// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice The cheatcodes these tests use, declared by hand at forge's cheatcode address; nothing else is pulled in.
interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function deal(address account, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes calldata revertData) external;
}

// Forge's cheatcode address, where `Vm` answers: derived from the same string the reference client uses.
address constant HEVM = address(uint160(uint256(keccak256("hevm cheat code"))));
