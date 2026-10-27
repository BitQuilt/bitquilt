// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Anchors holds, per sequence, the coin log's head and the Merkle root over its redeem lines, posted by a
/// bonded poster (docs/COIN.md, "The door out"). A posted head is bonded, not proven: anyone can check it against the
/// head the mirror stamped, and the veto address can strike a false one within the window and take the poster's bond
/// for the treasury. The veto can do that and nothing else. Once the window has passed a head is final, and `Quilt`
/// mints against its redeem root.
contract Anchors {
    struct Post {
        bytes32 head;
        bytes32 root;
        uint64 postedAt;
        address poster;
        bool vetoed;
        bool posted;
    }

    /// @notice The one address that may veto a post.
    address public immutable vetoer;
    /// @notice Where a slashed bond goes.
    address public immutable treasury;
    /// @notice The least a poster holds to post, in wei.
    uint256 public immutable minBond;
    /// @notice Seconds after a post during which the veto may strike it.
    uint64 public immutable vetoWindow;

    /// @notice The highest sequence posted so far.
    uint64 public lastSeq;
    /// @notice Each poster's bond in wei.
    mapping(address => uint256) public bonds;
    /// @notice The time of each poster's latest post; its bond stays until that post has left the window.
    mapping(address => uint64) public lastPostAt;
    mapping(uint64 => Post) private posts;

    event Bonded(address indexed poster, uint256 amount, uint256 bond);
    event Withdrawn(address indexed poster, uint256 amount, uint256 bond);
    event Posted(uint64 indexed seq, bytes32 head, bytes32 redeemRoot, address indexed poster);
    event Vetoed(uint64 indexed seq, string reason);

    constructor(address veto_, address treasury_, uint256 minBond_, uint64 vetoWindow_) {
        require(veto_ != address(0), "the vetoer is an address");
        require(treasury_ != address(0), "the treasury is an address");
        vetoer = veto_;
        treasury = treasury_;
        minBond = minBond_;
        vetoWindow = vetoWindow_;
    }

    /// @notice Adds to the sender's bond.
    function bond() external payable {
        require(msg.value > 0, "a bond is more than nothing");
        bonds[msg.sender] += msg.value;
        emit Bonded(msg.sender, msg.value, bonds[msg.sender]);
    }

    /// @notice Whether `poster` may post: its bond is at least the minimum.
    function allowed(address poster) public view returns (bool) {
        return bonds[poster] >= minBond;
    }

    /// @notice Posts the coin log's head and the root over its redeem lines at `seq`. The sequence goes up, except
    /// that a vetoed sequence may be posted again.
    function post(uint64 seq, bytes32 head, bytes32 redeemRoot) external {
        require(allowed(msg.sender), "the poster is not bonded");
        require(seq > lastSeq || posts[seq].vetoed, "the sequence is not newer than the last posted");
        posts[seq] = Post({head: head, root: redeemRoot, postedAt: uint64(block.timestamp), poster: msg.sender, vetoed: false, posted: true});
        if (seq > lastSeq) lastSeq = seq;
        lastPostAt[msg.sender] = uint64(block.timestamp);
        emit Posted(seq, head, redeemRoot, msg.sender);
    }

    /// @notice Strikes the head at `seq` within its window, once, and moves the poster's whole bond to the treasury.
    function veto(uint64 seq, string calldata reason) external {
        require(msg.sender == vetoer, "only the vetoer");
        Post storage p = posts[seq];
        require(p.posted, "nothing is posted at this sequence");
        require(!p.vetoed, "this post is vetoed already");
        require(block.timestamp < uint256(p.postedAt) + vetoWindow, "the window has passed");
        p.vetoed = true;
        uint256 slashed = bonds[p.poster];
        bonds[p.poster] = 0;
        emit Vetoed(seq, reason);
        if (slashed > 0) {
            (bool ok,) = treasury.call{value: slashed}("");
            require(ok, "the treasury did not take the bond");
        }
    }

    /// @notice Takes `amount` of the sender's bond back, once none of its posts is still inside the window.
    function withdraw(uint256 amount) external {
        require(amount <= bonds[msg.sender], "more than the bond");
        require(block.timestamp >= uint256(lastPostAt[msg.sender]) + vetoWindow, "a post is still inside the window");
        bonds[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount, bonds[msg.sender]);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "the poster did not take the bond");
    }

    /// @notice Whether the head at `seq` is posted, not vetoed, and past its window.
    function isFinal(uint64 seq) external view returns (bool) {
        Post storage p = posts[seq];
        return p.posted && !p.vetoed && block.timestamp >= uint256(p.postedAt) + vetoWindow;
    }

    /// @notice What is posted at `seq`: the head, the redeem root, when, by whom, and whether it was vetoed.
    function headAt(uint64 seq) external view returns (bytes32 head, bytes32 root, uint64 postedAt, address poster, bool vetoed) {
        Post storage p = posts[seq];
        return (p.head, p.root, p.postedAt, p.poster, p.vetoed);
    }
}
