# The coin

Written 26 October 2026, as a design, before any of it was built; the same day the stake, the gold and the coin as a layer were built, with transfers off until the founder's decision the next day, and [COIN-PLAN.md](COIN-PLAN.md) says in what order and what waits. This document says what the coin is. [CORE.md](CORE.md) is frozen and this changes nothing in it. [PROTOCOL.md](PROTOCOL.md) names the three extensions the coin rests on, [EXTENSIONS.md](EXTENSIONS.md) lists them and their documents under `ext/` say exactly what is built, and [OPEN-PROBLEM.md](OPEN-PROBLEM.md) records the decision this reverses.

## What it is

The coin is a layer over the ledger, in the shape standing already has. A tracker that carries it keeps one more log, the coin log, chained and anchored like a problem's, and derives from the problem logs it holds which squares were verified and which sets were struck. From those receipts and a published set of parameters it computes every root's balance, as it computes every root's standing. A fixed amount is minted each epoch and divided among the squares verified in it; what is minted vests with time; a root locks coin at a tracker's door to back a claim and loses it when the claim's square is struck; a problem's payer escrows coin that its workers are paid from; and once transfers are turned on, coin moves between addresses. Nobody needs a wallet, a gas token or a node to earn, hold, lock, pay or be paid. The tracker orders the lines and decides nothing: anyone with the receipts computes the same balances, the mirror does so and refuses a head it cannot reproduce, and the mirror stamps each head into Bitcoin through OpenTimestamps.

A chain enters once, later, as a door out. A holder who wants the coin on Ethereum posts a redeem on the coin log, which removes it from the ledger, and mints the same amount as an ERC-20 against a head a bonded poster put on the chain. The holder pays gas once, by choice, when the coin is worth it. The protocol never reads the chain, and a worker never needs it.

## Why, and what was given up

On 24 October 2026 the project wrote that there would be no money of any kind inside the platform, because a coin inside BitQuilt would make BitQuilt about the coin. On 26 October it re-argued that, as the sentence promised it would, and reversed it. The reason is where the protocol already puts cost. The open problem is that a root is free, so agreement is cheap; every known substitute for a cost that needs no identity is money, identity or work; and the protocol already admits a stake at the tracker's door, where a challenge is admitted only if the challenger's standing covers it. A stake of coin at the same door is the same mechanism with a second thing to stake. Bound to a root and admitted at the door, it is what condition 1 of the open problem allowed in its parenthesis from the first day.

What was given up is one sentence: no money inside the platform. What was not given up: the frozen core and its fixtures; a reducer that reads no chain and never will; a map that is the same for a client that knows nothing of the coin; and the way in for a worker who holds nothing, since standing earned by work satisfies any stake a problem asks, and a problem that asks none is open to a new root. The coin is a stake and a wage. It is not a gate, and it is not the point.

## Where it lives

Three extensions, each one a core client may ignore:

- **QX-15, stake at the door.** A problem's owner may ask that a claim on its pieces be backed by a stake. A root locks standing, or coin, before it claims; the tracker admits the claim only after the lock; the lock is released when the acceptance stands past its window and forfeited when the accepting set is struck. A coin lock is a line on the coin log, and the problem's tracker reads it there.
- **QX-16, gold pieces.** Before any work, an owner commits by hash to the answers of some pieces, each commitment binding the piece and the answer so the ledger shows how many and not which (blind since 27 October 2026), backed by a stake of the owner's own standing. After a piece is accepted the owner reveals, naming the piece; an accepting set whose agreed fields differ from the gold answer is struck, and its locks are forfeited, with no jury; a set that matches makes the square **verified**. A miss is itself challengeable by a struck root, and a held challenge restores the set and forfeits the owner's stake.
- **QX-17, the coin as a layer.** The coin log and its events (`lock`, `pay`, `burn`, `transfer`, `redeem`), the lines the layer derives from the problem logs (`verified`, `forfeit`, `release`, `accepted`, `complete`), one order over both by receipt, and the rules below.

The coin log is a pseudo-problem, `quilt:coin`, as the identity log is `quilt:identity`: chained from its hash (QX-11), served by the tracker, held by the mirror, anchored every period (QX-12). Its lines are signed by the roots that post them, so the tracker can refuse one and cannot forge one.

## How it is earned

Only verified squares earn it. Each epoch may mint at most a published amount, on a curve that declines over years to a tail it never falls below, and a unit of verified weight earns at most a published cap, so that a square in a thin epoch earns a known wage and the rest of the curve's amount is unminted (decided 28 October 2026, after [COIN-AUDIT.md](COIN-AUDIT.md)); what an epoch mints is divided among the squares verified in it, pro rata by weight, and an epoch with none mints nothing and carries nothing. A square's weight follows the independence of the pair that accepted it: full for an agreement across different declared vendors, less for the same vendor, none for an attest piece, which is the actor's own word. Coin arrives in a balance as the ledger moves; there is no claim and nothing to install. Coin minted at a time vests over a published period from then, and a lock, a burn or a payment may draw on unvested coin, so that a new root can stake what it just earned and put up a bounty with it the same day (decided 27 October 2026; payments drew on vested coin alone before), while a transfer or a redeem draws on vested coin alone.

Verified means, in this version, a gold match: an owner knew the answer in advance and the workers found it. Everything else is accepted, as the core says, and earns standing and payment and no emission. Audits by sortition, where a drawn panel re-does a sample of accepted squares, would verify the rest; they are a later number and the open problem's fourth direction.

## How it is spent and lost

- **A lock** at a tracker's door backs a claim. A struck set forfeits it. The forfeit takes the lock and as much again from the root's unvested coin as there is, so that what a fake earned inside the window is what a miss costs.
- **A payment.** Anyone may escrow coin to a problem with a price per square, from free coin vested or not. Each accepted set is paid from the escrow, divided among its credited roots, until the escrow is empty; when the problem completes, or its endgame passes with nothing left to pay, the rest goes back to the payer. An owner paying for their own problem is the ordinary case.
- **A burn** removes coin and the tracker credits standing at the rate it publishes. This is how a newcomer with coin and no history enters a staked problem, and it is a tracker's policy, not the protocol's. The home's rate is indexed: a point costs what a reveal in a verified cross-vendor square earned in the latest ended epoch, never less than a published floor, so that money buys the record of work at about the price work earns it (28 October 2026).
- **A transfer** moves vested free coin to any address, from the date the parameters name. The founder set it to genesis on 27 October 2026, so the coin moves from its first epoch, as Bitcoin's did. Turning transfers on at any date changes no history: the ledger before and after is the same ledger.
- **A redeem** removes coin from the ledger for minting on the chain, from the date the parameters name, once the door out exists.

## Who is paid

Workers earn the emission for verified squares and the payments for accepted ones. Payers, usually owners, buy nothing from the project: they escrow coin they earned or were given. A published share of each epoch goes to a treasury root, which pays the home tracker and the mirrors by a published rule; this is the infrastructure's income and the founder's. The rule, decided by the founder on 28 October 2026: at the end of each period of 365 epochs the treasury pays, by transfers on the coin log that anyone can read, each mirror that anchored every head of the period an equal share of half of what the treasury received in it, and keeps the other half for the home's running and the founder; the share itself, the tenth, is reviewed at the same time, the first review on 28 October 2027, and each review's outcome is written here. There is no premine and no sale of any kind, at launch or after. A foundation allocation, if counsel agrees there should be one, is small, vests over years and is public. Anything else the founder earns is earned above the protocol, by a company building things people pay for, as with every open protocol that has lasted.

## The parameters

The layer publishes its parameters in the tracker's well-known document, and they are the coin's constitution: a client reads them, a mirror checks balances against them, and a change to any of them is a new version of the layer that every reader can see. The founder decided the values below on 28 October 2026, after the audit in [COIN-AUDIT.md](COIN-AUDIT.md); the draft of 26 October, which fell by a quarter a year with no tail and no cap and priced a point of standing at a thousand units, is in the history. [LAUNCH.md](LAUNCH.md) carries them as the JSON the home is started with.

| Parameter | Draft | What turns on it |
| --- | --- | --- |
| `home` | the maintainers' tracker | whose order the coin lives under until it is bridged |
| `genesis` | the time of the first coin-log line | when epochs count from |
| `epoch_h` | 24 | how soon a square pays |
| `emission` | a coin a day for the first year, then falling by an eighth each year to a tail of a tenth of a coin a day, reached around year 17; a unit of verified weight earns at most 5,000 units an epoch, so a cross-vendor square earns at most 18,000 after the treasury's share, 9,000 to each worker, and fifty such squares saturate a day | how fast early workers are diluted; what a square is worth; what a ring alone in a quiet day can take |
| `vesting_h` | a week (decided 27 October 2026; a year before) | how much of an early fake stays catchable |
| `window_max_h` | 120 hours: two days inside the vesting period | the longest challenge window the home admits, so a late challenge still finds the coin unvested |
| `infra` | one tenth of each epoch to the treasury, reviewed at the end of each period of 365 epochs, the first on 28 October 2027 | how the infrastructure, and the founder, are paid |
| `treasury` | a root the maintainers hold, published | where the share goes |
| `unit` | a coin is a million units; whole-unit arithmetic, remainders unminted | rounding |
| `weights` | 1 across vendors, 1/2 within one vendor, 0 for attest | what farming earns |
| `forfeit` | the lock, and as much again from unvested coin | what a fake costs |
| `transfers_from` | genesis | when the coin can move, and the law's view of it |
| `redeem_from` | null | whether and when there is a door out |
| continuation | the maintainers' key names a successor, which continues the coin log from the last head the mirror anchored | what happens if the home halts |

The anchoring period stays the mirror's fifteen minutes. The burn rate is each tracker's own and is published beside its stake policy; the home's is indexed to what a reveal in a verified cross-vendor square earned in the latest ended epoch, with a floor of 100,000 units a point, a tenth of a coin.

## The door out

Two contracts, built on 27 October 2026 (`contracts/`, with Foundry, and `packages/coin`), and live on Ethereum mainnet from the first day by the founder's decision the same day, so that an organic market can form; counsel and an audit read them beside the launch rather than before it. `Quilt`, an ERC-20, mints only through `redeem(seq, id, to, amount, proof)`: a proof that the redeem line `id` stands under the redeem root posted at `seq` in `Anchors`, once per line, so that the chain's supply is never more than the ledger has redeemed. `Anchors` holds, per sequence, the coin log's head and a Merkle root over its redeem lines, posted by a bonded poster, and a veto that can strike a head within a window on a published reason and slash the bond, and can do nothing else. Both ways from the first day (the return path was built the same day, at the founder's direction): `deposit` on the contract burns the token and records the ledger root to credit, numbered, and a reader, the poster's mirror image under the same bond, posts a `credit` line on the coin log for each deposit as of the chain's finalized block; the mirror checks every credit against the chain and keeps no balances where one differs. The chain is Ethereum mainnet; the choice couples the door, never the map or the ledger coin, to the chain's liveness and keys. Only one file in the repository knows an RPC library (`packages/coin/src/chain.ts`), as only one knows a model SDK, and a tripwire test holds it there. The poster (`bitquilt-poster`) puts each head and its redeem root into `Anchors` every anchoring period; a holder's `quilt redeem` takes coin off the ledger, `bitquilt-claim` mints it with the proof once the head is final, `bitquilt-deposit` burns it back for a ledger root, and `bitquilt-reader` credits the ledger.

## Trust, said plainly

Until it is bridged, the coin is as decentralized as its home tracker. The home cannot forge a line, since every line is signed by its root, and cannot rewrite a line the mirror has anchored. It can halt, it can refuse a line, and it can order the lines it receives within an anchoring period. The mirror's copy, the Bitcoin stamp and the continuation rule are what bound that; the door out is the answer for anyone who wants a coin that no tracker orders. A tracker that honours coin locks and is not the home depends on the home for that one read, and when the home is unreachable it admits standing locks and refuses coin locks with the reason; the map is unaffected either way. A head posted to the chain is bonded, not proven; anyone can check it against the stamped head from the mirror, and the veto strikes a false one. A zero-knowledge proof of the layer would remove the bond and is not in this design.

## What it is not

- Not in the reducer. A client that ignores every line of this computes the same map.
- Not a gate. Standing earned by work satisfies any stake; a problem with no stake asked is open to a key with nothing; a tracker may honour no coin at all.
- Not for sale. No premine, no sale, no allocation but the small public one counsel may allow.
- Transferable from genesis, by the founder's decision of 27 October 2026, at the published date the parameters name.
- Not a ranking. A balance is public in effect, as standing is, since anyone with the receipts computes it; the site's pages show a holder their own and nobody else's, as they do with standing.
- Not held by anyone. A tracker keeps a record and never money; a custodial root holds coin as a record like any other and redeems it after taking the key home.
- Not a solution to the open problem. A stake prices a wrong square for the root that holds one; the square of a worker who staked nothing is the problem it was.

## The law

A unit earned by work and transferable is a security to some regulators, whether it lives in a ledger or on a chain. The design's answers are that nothing is sold, that emission is fixed and earned, that the coin's first use is as a stake and a wage inside the thing it is earned in, and that it is mined, never sold. These are arguments, not conclusions. The founder decided on 27 October 2026 that transfers are on from genesis, as a fair launch has them, and that counsel reads the design as launched rather than gating it; counsel still comes before the first contract on a chain.

## Status

Amended 28 October 2026 after [COIN-AUDIT.md](COIN-AUDIT.md), at the founder's direction: the curve gained a tail and a cap a unit of weight, the burn rate is indexed with a floor, the home bounds the challenge windows it admits, the parameters were decided, and the person-facing words say that standing is earned by work and not for sale and which coin is transferable now.

A design, 26 October 2026, and by the evening of the same day built through phase 3 of the plan: QX-15 ([ext/QX-15.md](ext/QX-15.md)), QX-16 ([ext/QX-16.md](ext/QX-16.md)) and QX-17 ([ext/QX-17.md](ext/QX-17.md)) stand in the reference tracker, the mirror and the client, with redemption off and no chain anywhere; transfers were set on from genesis by the founder's decision the next day. The documents amended the same day to carry it: `EXTENSIONS.md` (what an extension may not do; QX-15 to QX-17 reserved), `OPEN-PROBLEM.md` (condition 1, the money paragraph, direction 7, a dated note), `PROTOCOL.md` (the trust claim, the tip paragraph, a fourth thing a tracker decides, what is not here, where it is weak). The order of building is in [COIN-PLAN.md](COIN-PLAN.md); its first three phases make the coin with no chain at all, and the fourth is the door out.
