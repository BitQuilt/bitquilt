# The coin

Written 26 October 2026, as a design. Nothing of it is built; [COIN-PLAN.md](COIN-PLAN.md) says in what order it would be, and this document says what it is. [CORE.md](CORE.md) is frozen and this changes nothing in it. [PROTOCOL.md](PROTOCOL.md) names the three extensions the coin rests on, [EXTENSIONS.md](EXTENSIONS.md) reserves their numbers, and [OPEN-PROBLEM.md](OPEN-PROBLEM.md) records the decision this reverses.

## What it is

The coin is a layer over the ledger, in the shape standing already has. A tracker that carries it keeps one more log, the coin log, chained and anchored like a problem's, and derives from the problem logs it holds which squares were verified and which sets were struck. From those receipts and a published set of parameters it computes every root's balance, as it computes every root's standing. A fixed amount is minted each epoch and divided among the squares verified in it; what is minted vests with time; a root locks coin at a tracker's door to back a claim and loses it when the claim's square is struck; a problem's payer escrows coin that its workers are paid from; and once transfers are turned on, coin moves between addresses. Nobody needs a wallet, a gas token or a node to earn, hold, lock, pay or be paid. The tracker orders the lines and decides nothing: anyone with the receipts computes the same balances, the mirror does so and refuses a head it cannot reproduce, and the mirror stamps each head into Bitcoin through OpenTimestamps.

A chain enters once, later, as a door out. A holder who wants the coin on Ethereum posts a redeem on the coin log, which removes it from the ledger, and mints the same amount as an ERC-20 against a head a bonded poster put on the chain. The holder pays gas once, by choice, when the coin is worth it. The protocol never reads the chain, and a worker never needs it.

## Why, and what was given up

On 24 October 2026 the project wrote that there would be no money of any kind inside the platform, because a coin inside BitQuilt would make BitQuilt about the coin. On 26 October it re-argued that, as the sentence promised it would, and reversed it. The reason is where the protocol already puts cost. The open problem is that a root is free, so agreement is cheap; every known substitute for a cost that needs no identity is money, identity or work; and the protocol already admits a stake at the tracker's door, where a challenge is admitted only if the challenger's standing covers it. A stake of coin at the same door is the same mechanism with a second thing to stake. Bound to a root and admitted at the door, it is what condition 1 of the open problem allowed in its parenthesis from the first day.

What was given up is one sentence: no money inside the platform. What was not given up: the frozen core and its fixtures; a reducer that reads no chain and never will; a map that is the same for a client that knows nothing of the coin; and the way in for a worker who holds nothing, since standing earned by work satisfies any stake a problem asks, and a problem that asks none is open to a new root. The coin is a stake and a wage. It is not a gate, and it is not the point.

## Where it lives

Three extensions, each one a core client may ignore:

- **QX-15, stake at the door.** A problem's owner may ask that a claim on its pieces be backed by a stake. A root locks standing, or coin, before it claims; the tracker admits the claim only after the lock; the lock is released when the acceptance stands past its window and forfeited when the accepting set is struck. A coin lock is a line on the coin log, and the problem's tracker reads it there.
- **QX-16, gold pieces.** Before any work, an owner commits by hash to the answers of some pieces, backed by a stake of the owner's own standing. After a piece is accepted the owner reveals; an accepting set whose agreed fields differ from the gold answer is struck, and its locks are forfeited, with no jury; a set that matches makes the square **verified**. A miss is itself challengeable by a struck root, and a held challenge restores the set and forfeits the owner's stake.
- **QX-17, the coin as a layer.** The coin log and its events (`lock`, `pay`, `burn`, `transfer`, `redeem`), the lines the layer derives from the problem logs (`verified`, `forfeit`, `release`, `accepted`, `complete`), one order over both by receipt, and the rules below.

The coin log is a pseudo-problem, `quilt:coin`, as the identity log is `quilt:identity`: chained from its hash (QX-11), served by the tracker, held by the mirror, anchored every period (QX-12). Its lines are signed by the roots that post them, so the tracker can refuse one and cannot forge one.

## How it is earned

Only verified squares earn it. Each epoch mints a fixed amount on a published curve that declines over years; the amount is divided among the squares verified in that epoch, pro rata by weight, and an epoch with none mints nothing and carries nothing. A square's weight follows the independence of the pair that accepted it: full for an agreement across different declared vendors, less for the same vendor, none for an attest piece, which is the actor's own word. Coin arrives in a balance as the ledger moves; there is no claim and nothing to install. Coin minted at a time vests over a published period from then, and a lock or a burn may draw on unvested coin, so that a new root can stake what it just earned, while a payment, a transfer or a redeem draws on vested coin alone.

Verified means, in this version, a gold match: an owner knew the answer in advance and the workers found it. Everything else is accepted, as the core says, and earns standing and payment and no emission. Audits by sortition, where a drawn panel re-does a sample of accepted squares, would verify the rest; they are a later number and the open problem's fourth direction.

## How it is spent and lost

- **A lock** at a tracker's door backs a claim. A struck set forfeits it. The forfeit takes the lock and as much again from the root's unvested coin as there is, so that what a fake earned inside the window is what a miss costs.
- **A payment.** Anyone may escrow coin to a problem with a price per square. Each accepted set is paid from the escrow, divided among its credited roots, until the escrow is empty; when the problem completes, or its endgame passes with nothing left to pay, the rest goes back to the payer. An owner paying for their own problem is the ordinary case.
- **A burn** removes coin and the tracker credits standing at the rate it publishes. This is how a newcomer with coin and no history enters a staked problem, and it is a tracker's policy, not the protocol's.
- **A transfer** moves vested free coin to any address, from the date the parameters name. The date is null until the founder sets it with counsel. Turning transfers on changes no history: the ledger before and after is the same ledger.
- **A redeem** removes coin from the ledger for minting on the chain, from the date the parameters name, once the door out exists.

## Who is paid

Workers earn the emission for verified squares and the payments for accepted ones. Payers, usually owners, buy nothing from the project: they escrow coin they earned or were given. A published share of each epoch goes to a treasury root, which pays the home tracker and the mirrors by a published rule; this is the infrastructure's income and the founder's. There is no premine and no sale of any kind, at launch or after. A foundation allocation, if counsel agrees there should be one, is small, vests over years and is public. Anything else the founder earns is earned above the protocol, by a company building things people pay for, as with every open protocol that has lasted.

## The parameters, as a draft

The layer publishes its parameters in the tracker's well-known document, and they are the coin's constitution: a client reads them, a mirror checks balances against them, and a change to any of them is a new version of the layer that every reader can see. The defaults below are a draft for the founder to decide, written so that there is something to argue with.

| Parameter | Draft | What turns on it |
| --- | --- | --- |
| `home` | the maintainers' tracker | whose order the coin lives under until it is bridged |
| `genesis` | the time of the first coin-log line | when epochs count from |
| `epoch_h` | 24 | how soon a square pays |
| `emission` | a fixed amount a day for the first year, then falling by a fixed fraction each year; the amount and the fraction are the founder's | how fast early workers are diluted; what a square is worth |
| `vesting_h` | a year in the first year, shortening on a published schedule as detection matures | how much of an early fake stays catchable |
| `infra` | one tenth of each epoch to the treasury | how the infrastructure, and the founder, are paid |
| `treasury` | a root the maintainers hold, published | where the share goes |
| `unit` | a coin is a million units; whole-unit arithmetic, remainders unminted | rounding |
| `weights` | 1 across vendors, 1/2 within one vendor, 0 for attest | what farming earns |
| `forfeit` | the lock, and as much again from unvested coin | what a fake costs |
| `transfers_from` | null | when the coin can move, and the law's view of it |
| `redeem_from` | null | whether and when there is a door out |
| continuation | the maintainers' key names a successor, which continues the coin log from the last head the mirror anchored | what happens if the home halts |

The anchoring period stays the mirror's fifteen minutes. The burn rate is each tracker's own and is published beside its stake policy, not here.

## The door out

Two contracts, built last and only if the founder decides to, after the coin has a history worth bridging and counsel has read the design. `Quilt`, an ERC-20, mints only through `redeem(root, amount, proof)`: a proof that a redeem line stands under a head in `Anchors`, once per line, so that the chain's supply is never more than the ledger has redeemed. `Anchors` holds, per sequence, the coin log's head and a Merkle root over its redeem lines, posted by a bonded poster, and a veto that can strike a head within a window on a published reason and slash the bond, and can do nothing else. One way at first; a return path is a later decision. The chain is undecided and a testnet comes first; the choice couples the door, never the map or the ledger coin, to a chain's liveness and keys. Only one file in the repository will know an RPC library, as only one knows a model SDK, and a tripwire test will hold it.

## Trust, said plainly

Until it is bridged, the coin is as decentralized as its home tracker. The home cannot forge a line, since every line is signed by its root, and cannot rewrite a line the mirror has anchored. It can halt, it can refuse a line, and it can order the lines it receives within an anchoring period. The mirror's copy, the Bitcoin stamp and the continuation rule are what bound that; the door out is the answer for anyone who wants a coin that no tracker orders. A tracker that honours coin locks and is not the home depends on the home for that one read, and when the home is unreachable it admits standing locks and refuses coin locks with the reason; the map is unaffected either way. A head posted to the chain is bonded, not proven; anyone can check it against the stamped head from the mirror, and the veto strikes a false one. A zero-knowledge proof of the layer would remove the bond and is not in this design.

## What it is not

- Not in the reducer. A client that ignores every line of this computes the same map.
- Not a gate. Standing earned by work satisfies any stake; a problem with no stake asked is open to a key with nothing; a tracker may honour no coin at all.
- Not for sale. No premine, no sale, no allocation but the small public one counsel may allow.
- Not transferable until the founder says so, with counsel, by a published date.
- Not a ranking. A balance is public in effect, as standing is, since anyone with the receipts computes it; the site's pages show a holder their own and nobody else's, as they do with standing.
- Not held by anyone. A tracker keeps a record and never money; a custodial root holds coin as a record like any other and redeems it after taking the key home.
- Not a solution to the open problem. A stake prices a wrong square for the root that holds one; the square of a worker who staked nothing is the problem it was.

## The law

A unit earned by work and transferable is a security to some regulators, whether it lives in a ledger or on a chain. The design's answers are that nothing is sold, that emission is fixed and earned, that the coin's first use is as a stake and a wage inside the thing it is earned in, and that it does not move until a lawyer has read this. These are arguments, not conclusions, and counsel comes before `transfers_from` is set, not before the first contract.

## Status

A design, 26 October 2026. The documents amended the same day to carry it: `EXTENSIONS.md` (what an extension may not do; QX-15 to QX-17 reserved), `OPEN-PROBLEM.md` (condition 1, the money paragraph, direction 7, a dated note), `PROTOCOL.md` (the trust claim, the tip paragraph, a fourth thing a tracker decides, what is not here, where it is weak). The order of building is in [COIN-PLAN.md](COIN-PLAN.md); its first three phases make the coin with no chain at all, and the fourth is the door out.
