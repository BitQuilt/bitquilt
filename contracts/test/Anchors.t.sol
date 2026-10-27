// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Anchors} from "../src/Anchors.sol";
import {Vm, Cheats} from "./Vm.sol";

/// @notice Anchors: a bond makes a poster allowed; a post needs the bond and a newer sequence; the veto strikes a
/// head inside the window, takes the bond for the treasury, and can do so once; a vetoed sequence may be posted
/// again; a bond stays while a post is inside the window; a head is final once the window has passed.
contract AnchorsTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address constant VETOER = address(0xA11CE);
    address constant TREASURY = address(0x7EA5);
    address constant POSTER = address(0xB0B);
    address constant OTHER = address(0xCA7);
    uint256 constant MIN_BOND = 1 ether;
    uint64 constant WINDOW = 1 days;
    bytes32 constant HEAD = bytes32(uint256(0xAAAA));
    bytes32 constant ROOT = bytes32(uint256(0xBBBB));
    uint256 constant START = 1_800_000_000;

    Anchors anchors;

    function setUp() public {
        anchors = new Anchors(VETOER, TREASURY, MIN_BOND, WINDOW);
        vm.deal(POSTER, 10 ether);
        vm.deal(OTHER, 10 ether);
        vm.warp(START);
    }

    function bondAndPost(uint64 seq) internal {
        vm.startPrank(POSTER);
        anchors.bond{value: MIN_BOND}();
        anchors.post(seq, HEAD, ROOT);
        vm.stopPrank();
    }

    function testBondingMakesAPosterAllowed() public {
        require(!anchors.allowed(POSTER), "nothing bonded");
        vm.startPrank(POSTER);
        anchors.bond{value: 0.5 ether}();
        require(!anchors.allowed(POSTER), "half a bond");
        anchors.bond{value: 0.5 ether}();
        vm.stopPrank();
        require(anchors.allowed(POSTER), "a whole bond");
        require(anchors.bonds(POSTER) == 1 ether, "the bond adds up");
        require(address(anchors).balance == 1 ether, "the contract holds it");
    }

    function testAPostIsRefusedUnbonded() public {
        vm.prank(OTHER);
        vm.expectRevert(bytes("the poster is not bonded"));
        anchors.post(1, HEAD, ROOT);
        vm.prank(OTHER);
        anchors.bond{value: MIN_BOND - 1}();
        vm.prank(OTHER);
        vm.expectRevert(bytes("the poster is not bonded"));
        anchors.post(1, HEAD, ROOT);
    }

    function testAPostIsRefusedOutOfOrder() public {
        bondAndPost(2);
        require(anchors.lastSeq() == 2, "last is 2");
        vm.startPrank(POSTER);
        vm.expectRevert(bytes("the sequence is not newer than the last posted"));
        anchors.post(2, HEAD, ROOT);
        vm.expectRevert(bytes("the sequence is not newer than the last posted"));
        anchors.post(1, HEAD, ROOT);
        anchors.post(5, HEAD, ROOT);
        vm.stopPrank();
        require(anchors.lastSeq() == 5, "last is 5");
        (bytes32 head, bytes32 root, uint64 postedAt, address poster, bool vetoed) = anchors.headAt(5);
        require(head == HEAD && root == ROOT && postedAt == START && poster == POSTER && !vetoed, "what was posted");
    }

    function testAVetoInsideTheWindowSlashesToTheTreasury() public {
        bondAndPost(1);
        vm.warp(START + WINDOW - 1);
        vm.prank(VETOER);
        anchors.veto(1, "the head is not the one the mirror stamped");
        require(TREASURY.balance == MIN_BOND, "the treasury has the bond");
        require(anchors.bonds(POSTER) == 0, "the poster has none");
        require(!anchors.allowed(POSTER), "the poster is not allowed");
        (,,,, bool vetoed) = anchors.headAt(1);
        require(vetoed, "marked vetoed");
        vm.warp(START + WINDOW);
        require(!anchors.isFinal(1), "a vetoed head is not final");
    }

    function testAVetoAfterTheWindowIsRefused() public {
        bondAndPost(1);
        vm.warp(START + WINDOW);
        vm.prank(VETOER);
        vm.expectRevert(bytes("the window has passed"));
        anchors.veto(1, "too late");
        require(anchors.isFinal(1), "final");
        require(anchors.bonds(POSTER) == MIN_BOND, "the bond stays");
    }

    function testASecondVetoIsRefused() public {
        bondAndPost(1);
        vm.prank(VETOER);
        anchors.veto(1, "once");
        vm.prank(VETOER);
        vm.expectRevert(bytes("this post is vetoed already"));
        anchors.veto(1, "twice");
    }

    function testOnlyTheVetoerVetoes() public {
        bondAndPost(1);
        vm.prank(OTHER);
        vm.expectRevert(bytes("only the vetoer"));
        anchors.veto(1, "not mine to say");
        vm.prank(VETOER);
        vm.expectRevert(bytes("nothing is posted at this sequence"));
        anchors.veto(2, "nothing there");
    }

    function testAVetoedSequenceMayBePostedAgain() public {
        bondAndPost(1);
        vm.prank(POSTER);
        anchors.post(2, HEAD, ROOT);
        vm.prank(VETOER);
        anchors.veto(1, "struck");
        vm.prank(POSTER);
        vm.expectRevert(bytes("the poster is not bonded"));
        anchors.post(1, bytes32(uint256(0xCCCC)), bytes32(uint256(0xDDDD)));
        vm.warp(START + 100);
        vm.startPrank(OTHER);
        anchors.bond{value: MIN_BOND}();
        anchors.post(1, bytes32(uint256(0xCCCC)), bytes32(uint256(0xDDDD)));
        vm.stopPrank();
        (bytes32 head, bytes32 root, uint64 postedAt, address poster, bool vetoed) = anchors.headAt(1);
        require(head == bytes32(uint256(0xCCCC)) && root == bytes32(uint256(0xDDDD)), "the new head and root");
        require(postedAt == START + 100 && poster == OTHER && !vetoed, "a fresh post");
        require(anchors.lastSeq() == 2, "the last sequence stays");
        vm.warp(START + 100 + WINDOW);
        require(anchors.isFinal(1), "final once its own window has passed");
        vm.prank(OTHER);
        vm.expectRevert(bytes("the sequence is not newer than the last posted"));
        anchors.post(1, HEAD, ROOT);
    }

    function testABondStaysWhileAPostIsInsideTheWindow() public {
        bondAndPost(1);
        vm.startPrank(POSTER);
        vm.expectRevert(bytes("a post is still inside the window"));
        anchors.withdraw(MIN_BOND);
        vm.warp(START + WINDOW - 1);
        vm.expectRevert(bytes("a post is still inside the window"));
        anchors.withdraw(1);
        vm.warp(START + WINDOW);
        vm.expectRevert(bytes("more than the bond"));
        anchors.withdraw(MIN_BOND + 1);
        uint256 before = POSTER.balance;
        anchors.withdraw(MIN_BOND);
        vm.stopPrank();
        require(POSTER.balance == before + MIN_BOND, "the bond came back");
        require(anchors.bonds(POSTER) == 0 && !anchors.allowed(POSTER), "nothing bonded now");
    }

    function testIsFinalNeedsAPostAndThePassedWindow() public {
        require(!anchors.isFinal(1), "nothing posted");
        bondAndPost(1);
        require(!anchors.isFinal(1), "just posted");
        vm.warp(START + WINDOW - 1);
        require(!anchors.isFinal(1), "inside the window");
        vm.warp(START + WINDOW);
        require(anchors.isFinal(1), "the window has passed");
    }
}
