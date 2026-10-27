// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Anchors} from "../src/Anchors.sol";
import {Merkle} from "../src/Merkle.sol";
import {Quilt} from "../src/Quilt.sol";
import {Vm} from "./Vm.sol";
import {Fixture} from "./Fixture.sol";

/// @notice Quilt mints only through redeem: refused before the head's window has passed, refused on a wrong proof,
/// refused twice for one line, refused under a vetoed head; once, with the balance and the supply equal to the
/// amount; and the coin then moves as an ERC-20 does.
contract QuiltTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address constant VETOER = address(0xA11CE);
    address constant TREASURY = address(0x7EA5);
    address constant POSTER = address(0xB0B);
    uint256 constant MIN_BOND = 1 ether;
    uint64 constant WINDOW = 1 days;
    bytes32 constant HEAD = bytes32(uint256(0xAAAA));
    uint256 constant START = 1_800_000_000;
    uint64 constant SEQ = 9;

    Anchors anchors;
    Quilt quilt;

    function setUp() public {
        anchors = new Anchors(VETOER, TREASURY, MIN_BOND, WINDOW);
        quilt = new Quilt(anchors);
        vm.deal(POSTER, 10 ether);
        vm.warp(START);
        vm.startPrank(POSTER);
        anchors.bond{value: MIN_BOND}();
        anchors.post(SEQ, HEAD, Merkle.root(Fixture.leaves()));
        vm.stopPrank();
    }

    function proofOfA() internal pure returns (bytes32[] memory) {
        return Merkle.proof(Fixture.leaves(), Fixture.LEAF_A);
    }

    function testTheName() public view {
        require(keccak256(bytes(quilt.name())) == keccak256("Quilt"), "name");
        require(keccak256(bytes(quilt.symbol())) == keccak256("QUILT"), "symbol");
        require(quilt.decimals() == 6, "six decimals, one base unit a ledger unit");
        require(address(quilt.anchors()) == address(anchors), "the anchors");
    }

    function testRedeemIsRefusedBeforeTheWindowPasses() public {
        vm.expectRevert(bytes("the head is not final"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, proofOfA());
        vm.warp(START + WINDOW - 1);
        vm.expectRevert(bytes("the head is not final"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, proofOfA());
        require(quilt.totalSupply() == 0, "nothing minted");
    }

    function testRedeemIsRefusedWithAWrongProof() public {
        vm.warp(START + WINDOW);
        bytes32[] memory pa = proofOfA();
        vm.expectRevert(bytes("the proof does not reach the root"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A + 1, pa);
        vm.expectRevert(bytes("the proof does not reach the root"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_B, Fixture.AMOUNT_A, pa);
        vm.expectRevert(bytes("the proof does not reach the root"));
        quilt.redeem(SEQ, Fixture.ID_B, Fixture.TO_B, Fixture.AMOUNT_B, pa);
        bytes32[] memory none = new bytes32[](0);
        vm.expectRevert(bytes("the proof does not reach the root"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, none);
        vm.expectRevert(bytes("the head is not final"));
        quilt.redeem(SEQ + 1, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, pa);
        require(quilt.totalSupply() == 0, "nothing minted");
    }

    function testRedeemSucceedsOnceAndIsRefusedTwice() public {
        vm.warp(START + WINDOW);
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, proofOfA());
        require(quilt.balanceOf(Fixture.TO_A) == Fixture.AMOUNT_A, "the balance is the amount");
        require(quilt.totalSupply() == Fixture.AMOUNT_A, "the supply is the amount");
        require(quilt.redeemed(Fixture.ID_A), "the line is marked");
        vm.expectRevert(bytes("this line is redeemed already"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, proofOfA());
        require(quilt.totalSupply() == Fixture.AMOUNT_A, "the supply did not move");
        quilt.redeem(SEQ, Fixture.ID_C, Fixture.TO_C, Fixture.AMOUNT_C, Merkle.proof(Fixture.leaves(), Fixture.LEAF_C));
        require(quilt.totalSupply() == Fixture.AMOUNT_A + Fixture.AMOUNT_C, "two lines, two amounts");
    }

    function testRedeemIsRefusedUnderAVetoedHead() public {
        vm.prank(VETOER);
        anchors.veto(SEQ, "struck");
        vm.warp(START + WINDOW);
        vm.expectRevert(bytes("the head is not final"));
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, proofOfA());
    }

    function testTheCoinMovesAsAnErc20() public {
        vm.warp(START + WINDOW);
        quilt.redeem(SEQ, Fixture.ID_A, Fixture.TO_A, Fixture.AMOUNT_A, proofOfA());
        vm.prank(Fixture.TO_A);
        require(quilt.transfer(Fixture.TO_B, 400_000), "transfer");
        require(quilt.balanceOf(Fixture.TO_A) == 600_000 && quilt.balanceOf(Fixture.TO_B) == 400_000, "moved");
        vm.prank(Fixture.TO_A);
        vm.expectRevert(bytes("more than the balance"));
        quilt.transfer(Fixture.TO_B, 600_001);
        vm.prank(Fixture.TO_A);
        require(quilt.approve(Fixture.TO_C, 100_000), "approve");
        require(quilt.allowance(Fixture.TO_A, Fixture.TO_C) == 100_000, "allowance");
        vm.prank(Fixture.TO_C);
        vm.expectRevert(bytes("more than the allowance"));
        quilt.transferFrom(Fixture.TO_A, Fixture.TO_C, 100_001);
        vm.prank(Fixture.TO_C);
        require(quilt.transferFrom(Fixture.TO_A, Fixture.TO_C, 100_000), "transferFrom");
        require(quilt.allowance(Fixture.TO_A, Fixture.TO_C) == 0, "spent");
        require(quilt.balanceOf(Fixture.TO_C) == 100_000 && quilt.balanceOf(Fixture.TO_A) == 500_000, "moved again");
        require(quilt.totalSupply() == Fixture.AMOUNT_A, "the supply is what was redeemed");
    }
}
