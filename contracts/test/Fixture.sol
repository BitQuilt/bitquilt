// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Three fixed redeem lines and what the tree over them comes to. packages/coin/test/merkle.test.ts holds the
/// same numbers for the TypeScript tree; the root was computed there and checked by hand with cast before it was
/// written down here.
library Fixture {
    bytes32 constant ID_A = 0x0101010101010101010101010101010101010101010101010101010101010101;
    bytes32 constant ID_B = 0x0202020202020202020202020202020202020202020202020202020202020202;
    bytes32 constant ID_C = 0x0303030303030303030303030303030303030303030303030303030303030303;
    address constant TO_A = 0x1111111111111111111111111111111111111111;
    address constant TO_B = 0x2222222222222222222222222222222222222222;
    address constant TO_C = 0x3333333333333333333333333333333333333333;
    uint256 constant AMOUNT_A = 1_000_000;
    uint256 constant AMOUNT_B = 2_500_000;
    uint256 constant AMOUNT_C = 7;

    bytes32 constant LEAF_A = 0xd3801f5f4f128a03cf5bdb2de12c20b9e9aabee980d3b713cce0f9b5ee79d88b;
    bytes32 constant LEAF_B = 0xd8528bcf228f32a5224248696e1a525d6ecb051ddbfbbbac1d04eb9b6b7ca2cf;
    bytes32 constant LEAF_C = 0xf1a41eb11b3af38a12fbe92e61d1bfbec6867722ca55a7ac4b5a4056abe499a4;
    /// The pair of A and B, which stands beside C under the root.
    bytes32 constant PAIR_AB = 0x9e3667452b4a4a8c01cda75e6a9c7f0967cc9c32f9f527189dc8b218c0ea1ccd;
    bytes32 constant ROOT = 0x5a13d80b100b007f43e3de1dce34d2f48eac81f14792c1b0545d9f7bc863aebb;

    function leaves() internal pure returns (bytes32[] memory out) {
        out = new bytes32[](3);
        out[0] = LEAF_C;
        out[1] = LEAF_A;
        out[2] = LEAF_B;
    }
}
