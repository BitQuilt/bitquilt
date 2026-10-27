// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice The Merkle tree over the coin log's redeem lines, the same recipe as packages/coin/src/merkle.ts.
/// A leaf is keccak256(abi.encode(id, to, amount)). Leaves are sorted ascending before the tree is built; a pair
/// is hashed with the smaller first, so a proof is a list of siblings and carries no side bits; an odd node at any
/// level is carried up unchanged; the root of no leaves is zero and the root of one leaf is the leaf itself.
/// `Quilt` uses `leaf` and `verify`; `root` and `proof` build a tree in memory and serve the tests.
library Merkle {
    function leaf(bytes32 id, address to, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, to, amount));
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice Whether `leafHash` stands under `rootHash` by way of `siblings`, bottom first.
    function verify(bytes32 rootHash, bytes32 leafHash, bytes32[] calldata siblings) internal pure returns (bool) {
        bytes32 node = leafHash;
        for (uint256 i = 0; i < siblings.length; i++) node = pair(node, siblings[i]);
        return node == rootHash;
    }

    /// @notice The leaves sorted ascending, in a copy.
    function sorted(bytes32[] memory leaves) internal pure returns (bytes32[] memory) {
        bytes32[] memory out = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            bytes32 v = leaves[i];
            uint256 j = i;
            while (j > 0 && out[j - 1] > v) {
                out[j] = out[j - 1];
                j--;
            }
            out[j] = v;
        }
        return out;
    }

    function levelUp(bytes32[] memory level) internal pure returns (bytes32[] memory) {
        bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
        for (uint256 i = 0; i < level.length; i += 2) {
            next[i / 2] = i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i];
        }
        return next;
    }

    /// @notice The root over `leaves`, in any order.
    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        if (leaves.length == 0) return bytes32(0);
        bytes32[] memory level = sorted(leaves);
        while (level.length > 1) level = levelUp(level);
        return level[0];
    }

    /// @notice The siblings from `leafHash` up to the root over `leaves`, bottom first; empty for a tree of one.
    function proof(bytes32[] memory leaves, bytes32 leafHash) internal pure returns (bytes32[] memory) {
        bytes32[] memory level = sorted(leaves);
        uint256 index = level.length;
        for (uint256 i = 0; i < level.length; i++) {
            if (level[i] == leafHash) {
                index = i;
                break;
            }
        }
        require(index < level.length, "the leaf is not among the leaves");
        bytes32[] memory path = new bytes32[](64);
        uint256 n = 0;
        while (level.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < level.length) path[n++] = level[sibling];
            index = index >> 1;
            level = levelUp(level);
        }
        bytes32[] memory out = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) out[i] = path[i];
        return out;
    }
}
