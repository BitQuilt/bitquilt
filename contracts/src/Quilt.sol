// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Anchors} from "./Anchors.sol";
import {Merkle} from "./Merkle.sol";

/// @notice Quilt is the coin on the chain: an ERC-20 with six decimals, so that one base unit is one unit of the
/// ledger's coin. Nobody owns it and nothing mints it but `redeem`: a proof that a redeem line stands under a redeem
/// root that `Anchors` holds as final, taken once per line. The chain's supply stays at or below what the ledger has
/// redeemed (docs/COIN.md, "The door out").
contract Quilt {
    string public constant name = "Quilt";
    string public constant symbol = "QUILT";
    uint8 public constant decimals = 6;

    Anchors public immutable anchors;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// @notice The redeem lines minted so far, by the coin log line's hash.
    mapping(bytes32 => bool) public redeemed;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Redeemed(bytes32 indexed id, address indexed to, uint256 amount, uint64 seq);

    constructor(Anchors anchors_) {
        require(address(anchors_) != address(0), "the anchors are an address");
        anchors = anchors_;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "more than the allowance");
        allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    /// @notice Mints `amount` to `to` for the redeem line `id`, once, given a proof that its leaf stands under the
    /// redeem root posted at `seq` and that the head there is final.
    function redeem(uint64 seq, bytes32 id, address to, uint256 amount, bytes32[] calldata proof) external {
        require(to != address(0), "the coin is minted to an address");
        require(!redeemed[id], "this line is redeemed already");
        require(anchors.isFinal(seq), "the head is not final");
        (, bytes32 root,,,) = anchors.headAt(seq);
        require(Merkle.verify(root, Merkle.leaf(id, to, amount), proof), "the proof does not reach the root");
        redeemed[id] = true;
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Redeemed(id, to, amount, seq);
    }

    function _move(address from, address to, uint256 amount) private {
        require(to != address(0), "the coin moves to an address");
        uint256 have = balanceOf[from];
        require(have >= amount, "more than the balance");
        balanceOf[from] = have - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
