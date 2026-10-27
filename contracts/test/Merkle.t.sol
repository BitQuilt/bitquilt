// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Merkle} from "../src/Merkle.sol";
import {Fixture} from "./Fixture.sol";

/// @notice The Solidity tree against the fixture the TypeScript tree is held to: the same leaves, the same root,
/// the same proofs; a wrong leaf stays outside; no leaves give zero and one leaf gives itself.
contract MerkleTest {
    function check(bytes32 rootHash, bytes32 leafHash, bytes32[] calldata siblings) external pure returns (bool) {
        return Merkle.verify(rootHash, leafHash, siblings);
    }

    function testLeavesMatchTheFixture() public pure {
        require(Merkle.leaf(Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A) == Fixture.LEAF_A, "leaf A");
        require(Merkle.leaf(Fixture.ID_B, Fixture.TO_B, Fixture.AMOUNT_B) == Fixture.LEAF_B, "leaf B");
        require(Merkle.leaf(Fixture.ID_C, Fixture.TO_C, Fixture.AMOUNT_C) == Fixture.LEAF_C, "leaf C");
    }

    function testRootMatchesTheFixture() public pure {
        require(Merkle.root(Fixture.leaves()) == Fixture.ROOT, "root");
        require(Merkle.pair(Fixture.LEAF_A, Fixture.LEAF_B) == Fixture.PAIR_AB, "pair AB");
        require(Merkle.pair(Fixture.LEAF_B, Fixture.LEAF_A) == Fixture.PAIR_AB, "pair BA is the same");
    }

    function testProofsMatchTheFixture() public view {
        bytes32[] memory pa = Merkle.proof(Fixture.leaves(), Fixture.LEAF_A);
        require(pa.length == 2 && pa[0] == Fixture.LEAF_B && pa[1] == Fixture.LEAF_C, "proof of A");
        bytes32[] memory pb = Merkle.proof(Fixture.leaves(), Fixture.LEAF_B);
        require(pb.length == 2 && pb[0] == Fixture.LEAF_A && pb[1] == Fixture.LEAF_C, "proof of B");
        bytes32[] memory pc = Merkle.proof(Fixture.leaves(), Fixture.LEAF_C);
        require(pc.length == 1 && pc[0] == Fixture.PAIR_AB, "proof of C");
        require(this.check(Fixture.ROOT, Fixture.LEAF_A, pa), "A verifies");
        require(this.check(Fixture.ROOT, Fixture.LEAF_B, pb), "B verifies");
        require(this.check(Fixture.ROOT, Fixture.LEAF_C, pc), "C verifies");
    }

    function testAWrongLeafStaysOutside() public view {
        bytes32[] memory pa = Merkle.proof(Fixture.leaves(), Fixture.LEAF_A);
        bytes32 wrong = Merkle.leaf(Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A + 1);
        require(!this.check(Fixture.ROOT, wrong, pa), "a changed amount");
        require(!this.check(Fixture.ROOT, Fixture.LEAF_B, pa), "another leaf with A's proof");
        bytes32[] memory none = new bytes32[](0);
        require(!this.check(Fixture.ROOT, Fixture.LEAF_A, none), "an empty proof");
    }

    function testNoLeavesAndOneLeaf() public view {
        bytes32[] memory none = new bytes32[](0);
        require(Merkle.root(none) == bytes32(0), "no leaves");
        bytes32[] memory one = new bytes32[](1);
        one[0] = Fixture.LEAF_B;
        require(Merkle.root(one) == Fixture.LEAF_B, "one leaf is its own root");
        require(Merkle.proof(one, Fixture.LEAF_B).length == 0, "one leaf needs no proof");
        require(this.check(Fixture.LEAF_B, Fixture.LEAF_B, none), "one leaf verifies with none");
    }
}
