# Carrying a coin: the plan

Written 26 October 2026, before any of it is built, from the code as it stands at `07eae21`, and revised the same day so that the coin is a layer over the ledger first and a chain is a door out of it later. This is a plan to read and decide on, not a specification; the specifications are the extension documents it says to write. Nothing here changes a fixture, and every phase leaves the repository working.

Where it stands: phases 0 to 3 were built on 26 October 2026 (commits `c21512f`, `5255e32`, `f6bd774`, `486bd1f`), with the page's coin panel and the Mac line following the same day. Phase 4, the door out, was built on 27 October 2026 (`contracts/`, `packages/coin`, the redeem line on the ledger), and the founder decided the same day that it goes live on Ethereum mainnet on the first day, with counsel and the audit beside the launch rather than before it; what phase 5 lists is what remains for the maintainers' hands.

What the revision moved: emission, vesting, slashing, locks and payments were on contracts and are now rules of a layer the tracker computes, as standing is; the seven contracts became two, and they are the last phase instead of the middle; a worker needs no wallet, gas token or node for anything but the one step of redeeming ledger coin as an ERC-20, by choice, later. The three extensions stand as they were, with QX-17 changed from a bridge into the coin itself.

## 0. The decision it carries out

The reducer reads no chain, and neither does anything a worker needs. Stake enters at the tracker's door, where the protocol already puts cost (the gate, the stamp, a challenge's stake against standing). A problem may ask for stake on its claims; standing earned by work satisfies it, and so does coin locked in the ledger. Gold pieces, whose answers the owner committed to before the work, slash the stake of a wrong square without a jury. The coin is a layer over the ledger in the shape standing already has: a fixed emission per epoch is divided among that epoch's verified squares, vests with time, is slashed while unvested when a set is struck, is locked at the door, pays owners' bills, and moves between roots once transfers are turned on. Balances are a function of the receipts and the published parameters, computed by the tracker, by every mirror that holds its chains, and by anyone with the receipts; the home tracker orders the lines and decides nothing, and the mirror stamps its heads into Bitcoin. Nobody needs a wallet, a gas token or a node to earn, hold, lock or pay. A chain enters once, later, as a door out: a holder burns ledger coin and redeems the same amount as an ERC-20 on Ethereum against an anchored head, paying gas once, by choice, when the coin is worth it.

Six commitments the design rests on, each of which, given up, is a reason to stop and re-argue: the map in the ledger and the coin as a layer over it, never in the reducer and never on a chain the protocol has to read; fixed emission, never a coin per square; minting only for verified squares; no sale of any kind at launch; transfers on from genesis, decided by the founder on 27 October 2026 where the plan as written had them off until counsel; no gas and no wallet to work or earn, ever.

## 1. What stays as it is

- `docs/CORE.md`, the fixtures under `packages/core/fixtures`, and `impl/python`: untouched. No new setting (the envelope's settings are closed, `envelope.ts` line 136), no new field on a core event, nothing added to the piece hash or the problem hash. Every rule below is an extension in the sense of `docs/EXTENSIONS.md`: new event types the core ignores, functions of the ledger, admission policies at the door.
- `reduce` and `next`: unchanged. Stake and the coin are layers over the fold, as the challenge window is (`packages/tracker/src/challenge.ts`), and the door asks the layers before it admits, as it asks `admitChallenge` today.
- The identity log's pattern: events about no problem live on a pseudo-problem of their own (`IDENTITY_LOG` in `packages/core/src/events.ts`), chained under QX-11 and anchored under QX-12 like any problem's log. The coin gets a log of its own in the same shape, defined in the tracker package so the core package is not touched.
- Keys: a root is already an Ethereum account (secp256k1, EIP-55, EIP-191 signatures, BIP-39 phrase on the Ethereum path, `packages/core/src/keys.ts`). The same address holds coin in the ledger and, once redeemed, on Ethereum. No new key, and no wallet software to earn, hold, lock or pay; a wallet is needed only to redeem.
- The tests pass at the end of every phase, and the phases are ordered so that each is useful alone.

## 2. The documents, and what each has to say afterwards

| Document | What it says now | What it will say |
| --- | --- | --- |
| `EXTENSIONS.md`, "What an extension may not do" | "Require money, a token or a transferable credit of a worker." | "Make money, a token or a transferable credit the only way in for a worker: wherever a stake is asked, standing earned by work satisfies it, and a problem with no stake asked is always open to a new root." |
| `ext/QX-1.md`, section 2 | "Standing is what a root may stake, and nothing else: it weights no draw and gates no piece." | "...and, where a problem asks for stake under QX-15, what a root locks to claim." QX-1 is Draft; the amendment is to the same number. |
| `OPEN-PROBLEM.md`, condition 1 | "No money inside the protocol." | "The reducer reads no chain, and a worker with no coin is never shut out." A dated note records that the project reversed the decision condition 1 recorded, and why: the stake the open problem needs was already at the door for challenges, and a coin that is a function of the ledger, bound to a root through that door, is condition 1's own parenthesis. Direction 7 becomes the direction taken. |
| `PROTOCOL.md`, "What it guarantees" | "This design refuses money..." | "This design keeps money out of the reducer and admits a stake at the door..." |
| `PROTOCOL.md`, "Governance" | Three things a tracker decides. | Four: curation, admission, takedown, and the stake it honours (whether it carries the coin or reads a home that does, the rate a burn is credited at). |
| `PROTOCOL.md`, "What is deliberately not here" | "Money of any kind inside the platform... the design would be re-argued first." | The re-argument, in a paragraph, pointing at `COIN.md`; a chain stays out of the protocol, a door out of the ledger and never a part of it. |
| `PROTOCOL.md`, "Where it is weak" | | Three more: the coin's dependence on one home tracker until a chain carries it; a coin's price as something the protocol cannot bound; the bridge's trust in a bonded poster's heads, checkable against the Bitcoin stamp. |
| New `ext/QX-15.md`, `ext/QX-16.md`, `ext/QX-17.md` | | Sections 3 to 5 below, in the register of QX-1, with tests for every rule that decides state. |
| New `COIN.md` | | The coin's parameters as published, the economy they make, and the door out (section 6). The parameters are an extension's (QX-17), and a client that ignores them computes the same map; the door out is not an extension at all. |
| `README.md`, `AGENTS.md`, `DEPLOY.md` | | A line each: what the coin is and is not, the new environment names (phase 4 only), the new routes and package. |

The registry in `EXTENSIONS.md` gains the three numbers. `CORE.md` is left alone; its section 10 names extensions by pointing at `PROTOCOL.md`, which is enough.

## 3. QX-15: stake at the door

**Abstract.** A problem's owner may ask that a claim on its pieces be backed by stake. A root backs a claim by locking standing, or by locking coin in the home ledger (QX-17), and the tracker admits the claim only after the lock. A locked stake is released when the piece's acceptance stands past its window or the claim lapses, and forfeited when the accepting set is struck by a held challenge (QX-1) or a gold miss (QX-16). A root may turn coin into standing by a burn (QX-17) the tracker credits at its published rate. A core client ignores all of it.

### Events

| Type | Signer | Log | Body | Valid when |
| --- | --- | --- | --- | --- |
| `stake_rule` | the owner's root | the problem's | `{ min, pieces? }` | `min` a whole number from 0; `pieces`, if present, family names of the problem, else every piece. Applies to claims received after it. A later rule from the owner replaces it. |
| `lock` | the claiming root (or its delegate with `lock` in scope) | the problem's, about the piece | `{ kind: "standing", amount }` or `{ kind: "coin", amount, id }` | `amount` at least the rule's `min`. For standing: the root's free standing at the receipt covers `amount`. For coin: `id` is the hash of a `lock` line on the home ledger's coin log (QX-17) that is the root's, is at least `amount`, names this problem and piece, and is unspent, as the tracker reads it at the door and writes into the receipt. |

A `lock` precedes the `claim` it backs: a claim on a staked piece from a root with no unspent lock for that piece covering `min` is refused at the door with `this piece asks for a stake of N; lock first`. A lock with no claim within the problem's lease is spent for nothing and released. One lock backs one claim.

### Standing and locks

The layer computes, per root and time, beside standing (QX-1 section 2): **locked**, the sum of live standing locks; **free**, standing less locked, never below zero. A lock is live from its receipt until released or forfeited. Released: the backed claim's piece has an accepting set the root is in, completed, and its window has closed with no open challenge; or the claim lapsed or was declined. Forfeited: the accepting set the root was in was struck. A forfeited standing lock is a delta of `-amount` on the root from the strike, in addition to QX-1's own `-1` for a struck set; a forfeited coin lock is forfeited by the coin layer (QX-17, "Forfeit"). The rule is written so that the forfeit is at least the stake asked, whatever the kind.

### The door and the offers

- `postEvent` refuses, with the reason: `this piece asks for a stake of N; lock first`, `free standing M is below the lock of N`, `no such lock on the home ledger`, `the lock is spent`, `the lock names another piece`, `this tracker honours no coin lock`, `the owner alone sets a stake rule`.
- A coin lock is read at the door from the tracker's own coin layer when it is the home, and from the home's `GET /coin/lock/<id>` otherwise, through one function; the home's head at the read goes into the receipt's wrapper as the resolver's word: `stake: { kind, amount, home_head }`. A reader with no copy of the home ledger takes the tracker's word, as it takes `custody` today; a reader with one checks.
- The offer order (QX-4, QX-5) and `/p/<hash>/next` leave out a staked piece for a key whose free standing cannot cover it, unless the key says in its query that it will lock coin.
- The well-known document says `stake: { extension: "QX-15", coin: "here" | <home url> | null, burn_rate }`.

### What the client does

`next()` on a staked piece posts the `lock` and then the `claim` in one step, standing first, coin if standing is short and the tracker honours coin; the person's client asks once for the pair. `quilt_me` and `quilt me` show standing, locked, free. A hosted root (custody at the tracker) locks standing or coin like any other: the tracker holds a record, never money.

### Tests

`packages/tracker/test/stake.test.ts`: a claim refused without a lock; admitted with one; free standing falling and rising; a lock released when the window closes; a lock forfeited by a held challenge; the offers leaving out what a key cannot cover; a coin lock read from the home through a fake fetch and refused when it names another piece or is spent; a burn credited at the rate. `packages/client/test/stake.test.ts`: `next` locks then claims; the pair asked once; the text of `quilt_me`.

## 4. QX-16: gold pieces

**Abstract.** Before any work, an owner commits to the answers of some pieces by hash, each with its own nonce, in the commit recipe the core already has (`commitHash`). After a piece is accepted, the owner reveals. A reveal in the accepting set whose agreed fields differ from the gold answer is a miss: the set is struck, the roots lose standing as for a struck set, and their locks are forfeited. A match marks the square **verified**, which is what the coin's emission counts. A gold reveal is itself challengeable under QX-1 by a struck root, and a held challenge restores the set and forfeits the owner's own lock.

### Events

| Type | Signer | Log | Body | Valid when |
| --- | --- | --- | --- | --- |
| `gold` | the owner's root | the problem's | `{ commitments: { [piece hash]: h } }` | Each `h` is `commitHash(projection, nonce)`, with `projection` the agreed fields of the answer in canonical JSON. A commitment for a piece is kept only if received before the first claim on that piece; a late one is dropped with the reason. The owner holds a live `lock` on the problem of at least the rule's `gold_lock` per committed piece. |
| `gold_reveal` | the owner's root | the problem's, about the piece | `{ projection, nonce }` | The piece has an accepting set, completed at or before the receipt. `commitHash(projection, nonce)` is the piece's kept commitment. One reveal per piece. |

### The decision

- **Miss**: the accepting set's reveals, projected to the agreed fields, differ from `projection`. The set is struck as a held challenge strikes (QX-1 section 6): the core's reducer run without those events says what the piece is now, and it is offered again. Each root of the set takes QX-1's `-1` and loses its lock. The miss is a forfeit the coin layer applies (QX-17).
- **Match**: the set's projection equals `projection`. The piece is **verified**; its roots' locks are released at the window's close as usual.
- **Challenged**: within the window after a miss, a struck root may post a QX-1 `challenge` naming the gold reveal rather than an acceptance; the panel decides whether the gold was wrong. Held: the strike is undone, the set stands as the core had it, and the owner's lock is forfeited. Failed: the miss stands.
- A piece with no commitment is neither verified nor missed; it is what the core says.

### States and tests

The layer adds `verified: boolean` and `gold: "match" | "miss" | "pending" | null` to each piece. `packages/tracker/test/gold.test.ts`: a commitment kept before a claim and dropped after; a reveal refused before acceptance and refused when it does not match the commitment; a miss striking the set, forfeiting the locks and sending the piece back; a match marking verified; a challenge on a miss that holds and forfeits the owner; a problem without gold unchanged. `packages/client/test/gold.test.ts`: publishing with gold (the client computes the commitments, keeps the nonces and projections in the library, posts `gold` right after the envelope); attention listing a reveal that is due; `quilt_reveal_gold` posting it.

Gold reaches only problems whose owner knows some answers. Audits by sortition, where a drawn panel re-does a sample and a disagreement is a miss, are the way to verify the rest; they are a later number and not in this plan.

## 5. QX-17: the coin as a layer

**Abstract.** A tracker may carry a coin as a layer over its ledger, as QX-1 carries standing. The coin's own events live on one log of their own, the coin log, chained and anchored like a problem's; the squares that earn it and the strikes that slash it come from the problem logs the same tracker holds. A balance is a function of those receipts and the layer's published parameters, computed by the tracker, by every mirror that holds its chains, and by anyone with the receipts; the tracker's part is to order the lines, never to decide them. One tracker is the coin's home; another tracker that honours the coin reads the home's ledger at its door. A core client ignores all of it.

### The coin log

A pseudo-problem, `hashText('quilt:coin')`, defined beside the layer in `packages/tracker/src/coin.ts` (the core package is not touched), chained under QX-11 with the pseudo-problem's hash as genesis and anchored by the mirror under QX-12 as `anchors/<coin hash>/<seq>`. It is posted at `POST /coin/events` and read at `GET /coin/events?since=<seq>`, as the identity log is at `/k/events`. Its events name no problem in the event's own fields, as the identity log's do not; what one is about is in its body. Each line's hash is its id.

| Type | Signer | Body | Valid when |
| --- | --- | --- | --- |
| `lock` | a root (or its delegate with `lock` in scope) | `{ problem, piece, amount }` | The root's free coin at the receipt covers `amount`. Spent when a QX-15 `lock` on the problem names it; released or forfeited with that lock; released untouched after the problem's lease if no claim names it. |
| `pay` | a root | `{ problem, amount, per_square }` | Free coin, vested or not, covers `amount` (decided 27 October 2026; vested alone before), which is escrowed to the problem and paid out by the rule below. |
| `burn` | a root | `{ amount }` | Free coin covers `amount`. The coin is gone; the tracker credits standing at its published rate (QX-15). |
| `transfer` | a root | `{ to, amount }` | Received at or after `transfers_from`, which the home sets to its genesis; free vested coin covers `amount`. `to` is an address and need not be a root anywhere. |
| `redeem` | a root | `{ amount, to? }` | Received at or after `redeem_from`, null until the door out exists (section 6); free vested coin covers `amount`. The coin leaves the ledger. |

**Free** is a root's balance less what its live locks hold and its escrows hold. **Vested** is what the vesting rule has released of what it was minted. A lock, a burn or a pay may draw on unvested coin, so that a new root can stake what it just earned and post a bounty with it; a transfer or a redeem draws on vested coin only.

### What the layer derives from the problem logs

From the problem logs the tracker holds, the layer derives, in receipt order:

| Derived | From | For |
| --- | --- | --- |
| `verified` (problem, piece, root, vendor, weight, at) | a QX-16 match; one per root of the accepting set, weighted by the independence rule (full across different declared vendors, less for the same vendor, none for attest) | emission |
| `forfeit` (problem, piece, root, lock id, why, at) | a QX-1 strike or a QX-16 miss | slashing |
| `release` (problem, piece, root, lock id, at) | QX-15 | freeing a lock |
| `accepted` (problem, piece, roots, at) | the fold, roots by `creditedRoots` (reveals, not runs) | payments |
| `complete` (problem, at) | the fold | refunds |

The coin log's lines and the derived lines are ordered together by (received, log, seq), which is deterministic from the receipts: anyone holding them computes the same balances, and the mirror does.

### The rules

- **Emission.** Epochs of `epoch_h` from `genesis`. Each epoch mints `emission(n)` on the published declining curve, divided pro rata among the epoch's `verified` weights; an epoch with no verified square mints nothing, and nothing is carried. The infrastructure share `infra` of each epoch goes to the `treasury` root named in the parameters. Nothing else mints, and there is no claim step: coin arrives in a balance as a function of the ledger.
- **Vesting.** Coin minted at `t` vests linearly over `vesting_h` from `t`; a root's vested balance is the sum over its mintings. Coin received by transfer or payment is vested.
- **Forfeit.** A `forfeit` removes the lock's amount, and takes as much again from the root's unvested coin as there is, so that what a fake earned inside the window is what a miss costs.
- **Payments.** A `pay` escrows `amount` to the problem. Each `accepted` on that problem pays `per_square` from the escrow, divided among the set's credited roots, until the escrow is empty; `complete`, or the problem's endgame passing with no acceptance left to pay, refunds the rest to the payer. An owner paying for their own problem is the ordinary case; anyone may pay.
- **Locks.** A coin `lock` holds its amount until QX-15 releases or forfeits it.
- **Transfers.** Off until `transfers_from`; on, a transfer moves vested free coin to any address. Turning them on changes no history: the ledger before and after is the same ledger.
- **Burn.** Removes the coin; QX-15 credits standing.
- **Arithmetic.** Whole units; a coin is `unit` units (section 9), and nothing rounds in anyone's favour: a remainder stays unminted.

### Home and away

The parameters name the home, the maintainers' tracker. Another tracker that honours the coin says so in its well-known with the home's URL, reads a coin lock at its door from the home's `GET /coin/lock/<id>`, and keeps the home's head it read in the receipt. The home computes balances from the problems it holds, so a problem earns coin only if its owner lists the home among its trackers (`hints.trackers` in the envelope); a problem elsewhere earns standing there and no coin. The home can refuse and it can halt; it cannot forge a line, since every line is signed by its root, and it cannot rewrite a line the mirror has anchored. If it stops, a successor named by the maintainers' key continues the coin log from the last head the mirror anchored (the continuation rule, section 9).

### Routes and the well-known

`POST /coin/events`; `GET /coin/events?since=`; `GET /coin/lock/<id>` (the lock, spent or not, at head); `GET /coin/balance/<root>` (balance, vested, locked, escrowed, free, at head); `GET /coin/epochs?since=` (each epoch's minted sum and verified weight). The well-known says `coin: { extension: "QX-17", home: "here" | <url>, genesis, epoch_h, emission, vesting_h, infra, treasury, unit, transfers_from: null | <date>, redeem_from: null | <date> }`.

### The mirror

Holds the coin log beside the problem logs, verifies its chain, recomputes the layer from the receipts it holds, and refuses a head whose balances it cannot reproduce, as it refuses a chain that did anything but grow; anchors the head through OpenTimestamps every period and writes `coin/balances.json` at each head. This is what makes the record public rather than the home's: every balance ever shown is reproducible from receipts anyone can hold, under a head stamped in Bitcoin.

### What the client does

`quilt_me` shows coin: balance, vested, locked, escrowed. `next()` locks coin where standing is short (QX-15). `quilt_pay` escrows for a problem. `quilt_transfer` is offered once `transfers_from` has passed and `quilt_redeem` once the door out is open; until then neither is registered. There is no claim step and nothing to install.

### Tests

`packages/tracker/test/coin.test.ts`: an epoch's emission divided by verified weight, with none for attest and less for one vendor; nothing minted in an empty epoch; vesting by time; a forfeit taking the lock and the unvested; a pay escrowed, paid out per square by credited roots, and refunded on complete; a lock admitted at the home and, through a fake fetch, at a second tracker; a lock refused over free coin; a transfer refused before `transfers_from` and over vested free coin, admitted after; a burn credited as standing; the coin head recomputed from the receipts equal to the tracker's; the treasury's share. `packages/mirror/test/coin.test.ts`: the mirror reproducing every balance from receipts and refusing a head it cannot; the coin head anchored.

## 6. The door out: the coin on Ethereum, last

Not an extension. Described in `docs/COIN.md`, built on 27 October 2026 in `packages/coin` (TypeScript: the Merkle tree, the one chain door, the poster and the holder's claim) and `contracts/` (Solidity, Foundry, twenty-one tests); the client's `quilt redeem` posts the ledger line. The founder decided the same day that it goes live on mainnet on the first day; the ledger coin works without it for good.

### Contracts

| Contract | What it holds | Who calls it |
| --- | --- | --- |
| `Quilt` (ERC-20) | balances on the chain; minted only by `redeem(root, amount, proof)` against a head in `Anchors`, once per redeem line; total supply never above what the ledger has redeemed | a holder, paying the gas, to the address that is their root or the `to` their redeem named |
| `Anchors` | per poster: a bond, allowed or not; per sequence: the coin log's head, the Merkle root over the layer's redeem lines, the time | the bonded poster posts; anyone reads; the veto strikes within the window |

A veto multisig can strike a posted head within a window on a published reason and slash the bond; it cannot mint, move or change anything else. Two contracts, down from seven: everything the earlier shape of this plan had on the chain (locks, emission, vesting, payments, treasury) is in the ledger now.

### The redeem

A holder posts `redeem { amount, to? }` on the coin log and the layer removes the coin. The poster's next head carries the redeem line in its tree. The holder, or anyone for them, calls `redeem` with the proof, and the ERC-20 mints the amount to `to` or to the root's own address, which is the same key. Both ways, since 27 October 2026: `deposit` on the contract burns the token and records the ledger root, and a reader under the poster's bond posts a `credit` on the coin log for each finalized deposit, which the mirror checks against the chain. The holder's gas is paid once, at the redeem, by choice; the poster's heads, cents on a rollup, are the project's only recurring gas.

### One door to the chain

Only `packages/coin/src/chain.ts` imports an RPC library (`viem`): `postHead`, `redeem`, `readRedeemed`. `packages/coin/test/tripwire.test.ts` fails if any other file imports the library, as the rally's gateway tripwire does for model SDKs. RPC addresses, contract addresses and the poster's key come from the environment (`QUILT_CHAIN_RPC`, `QUILT_CHAIN_ID`, `QUILT_CONTRACTS`, `QUILT_POSTER_KEY`), listed in `DEPLOY.md`, never in code.

### The poster

A job beside the mirror (`packages/coin/src/post.ts`): every anchoring period, post the coin log's head and the redeem root from the bonded key. Idempotent: a posted head is kept as it is. The mirror's OpenTimestamps stamp is written beside, so a head has both anchors and anyone can check the one against the other.

### Chain, and trust said plainly

A testnet (Base Sepolia or Optimism Sepolia) for everything before launch. The mainnet choice couples the door out, never the map or the ledger coin, to a rollup's liveness, fees and upgrade keys; Ethereum L1 couples to none of that at a higher cost per redeem. The bridge trusts the poster's head under bond and the veto within its window; anyone checks a posted head against the stamped one from the mirror, and a mismatch is a fraud proof against the bond. A zero-knowledge proof of the layer removes the bond and is not in this plan.

## 7. The client, the page, the app

- `config.ts`: `stake: { lock_coin: boolean }`, whether `next()` may lock coin when standing is short (true by default; the person is still asked); `coin: { rpc, contracts } | null`, null by default, for the redeem call alone (phase 4).
- `worker.ts`: `next()` locks then claims (section 3); `publish()` takes `gold` in the pattern (a map from piece name to answer), computes commitments, posts `gold`, keeps projections and nonces in the library; `attention()` lists gold reveals due; new verbs `revealGold`, `pay`, `balance`, and later `transfer` and `redeem`.
- `tools.ts` and `mcp.ts`: `quilt_me` gains standing, locked, free and, where the tracker carries the coin, balance, vested, locked, escrowed; new tools `quilt_reveal_gold` and `quilt_pay`; `quilt_transfer` registered only once the tracker's `transfers_from` has passed and `quilt_redeem` only once `redeem_from` has; `quilt_open` and `quilt_read` show the stake rule, how many pieces carry gold, which squares are verified, and what a square pays where an escrow stands. Every description describes and never instructs, as the existing ones do.
- `bin.ts`: `quilt gold reveal <problem> <piece>`, `quilt pay <problem> <amount> <per_square>`, `quilt balance`, and later `quilt transfer <to> <amount>`, `quilt redeem <amount> [to]`.
- `page.ts` and `page/index.html`: a standing-and-coin panel; attention items for gold; `/api/me` carries the new fields.
- `apps/mac`: `API.swift` reads the new fields; `MenuView.swift` shows free standing and, where the tracker carries the coin, vested coin in one line.
- `packages/hosted`: locks of standing or coin through the hosted connector; the tracker holds a record, never money; a redeem needs the key, so a hosted member redeems after taking it home.

## 8. Phases

Each phase ends with `pnpm check` green, its documents written, and a commit. Sizes are rough engineer-days with an agent at hand; the external items in phase 5 are weeks and not the engineer's.

| Phase | What lands | Done when | Depends on | Size |
| --- | --- | --- | --- | --- |
| 0 | The document changes of section 2 that do not depend on code: `COIN.md` as a design, `OPEN-PROBLEM.md`, `EXTENSIONS.md`, `PROTOCOL.md`; counsel engaged; the parameter table of section 9 filled in as a draft | The documents read as one position; a lawyer has the design | nothing | 2 |
| 1 | QX-15 with standing only: `stake_rule`, standing `lock`, free standing, release and forfeit, the door, the offers, the client's lock-then-claim, `quilt_me` | The stake tests pass; a staked problem on a local tracker refuses a fresh root and admits one with standing | 0 | 4 |
| 2 | QX-16: `gold`, `gold_reveal`, miss and match, verified, the owner's lock, the challenge on a miss; publishing with gold; attention and `quilt_reveal_gold` | The gold tests pass; a demo problem with two gold pieces slashes a wrong pair and verifies a right one | 1 | 4 |
| 3 | QX-17: the coin log, the layer (emission, vesting, forfeit, payments, locks, burn), coin locks at the door at home and away, the routes, the mirror's check and anchor, `quilt_me`, `quilt_pay`, `quilt balance`, the page panel, the Mac line; transfers off | A demo: two roots earn coin from verified squares, one is slashed by a gold miss, an escrow pays a set, a coin lock admits a claim on a second tracker reading the home; the mirror reproduces every balance from receipts and anchors the head; nobody paid gas | 1, 2 | 6 |
| 4 | The door out: `redeem` on the ledger, `packages/coin` with the one door and the tripwire, `Quilt` and `Anchors` on a testnet with their tests, the poster, the veto; `quilt_redeem`; and, on the date counsel agrees, `transfers_from` set and `quilt_transfer` | On a testnet: a redeem line mints the same amount to the root's address; a bad head is struck and the bond slashed | 3, counsel | 6 |
| 5 | Launch readiness: counsel's opinion in hand; a contract audit; the parameters final; the fair-launch statement published; the poster bonded; the veto multisig composed; mainnet deploy; monitoring | Decided by the founder, not by this plan | 4, and the external items | 3, plus weeks outside |

Phases 1 to 3 stand with no chain at all: the coin is earned, staked, slashed, paid and recorded, and nobody pays gas. Phase 4 is a choice the founder makes later, not a dependency of anything above it. Phases 1 and 2 stand even with no coin: the flow is protected and gold slashes standing.

## 9. Decisions this plan leaves to the founder

| Decision | Default written here | What turns on it |
| --- | --- | --- |
| The home tracker | the maintainers' tracker | whose order the coin lives under until it is bridged |
| Continuation rule | the maintainers' key names a successor, which continues the coin log from the last head the mirror anchored | what happens to the coin if the home halts |
| Emission schedule | fixed per epoch, declining by a published curve over years | how fast early workers are diluted; how much a square is worth |
| Epoch and anchoring period | a day; fifteen minutes | how soon a square pays; how often a head is stamped |
| Unit | a coin is a million units; whole-unit arithmetic | rounding |
| Vesting | long in the first year, shortening as detection matures | how much of an early fake stays catchable |
| Forfeit | the lock, and as much again from unvested coin | what a fake costs |
| Independence weights | full weight for an agree set across different declared vendors, less for the same vendor, none for attest | what farming earns |
| Infrastructure share | a published fraction of each epoch to the treasury root, which pays the home and the mirrors by a published rule | how the infrastructure, and the founder, are paid |
| Foundation allocation | none, or small, vested over years, public | the securities question's weight; credibility |
| Transfers from | genesis, by the founder's decision of 27 October 2026 | when the coin can move, and the law's view of it |
| Redeem from, and the chain | null; the chain undecided, a testnet first | whether and when there is a door out |
| Return path | none in version 1 | one way or two |
| Veto multisig and window | the maintainers plus two outsiders; a week | how long a bad head stands before it is struck |
| Poster bond | enough that a false head costs more than it could mint before it is struck | what the poster risks |
| Burn-for-standing rate | a tracker policy, published at its well-known | how a rich newcomer enters |
| Owner's gold lock | per committed piece, at least the rule's `min` | the cost of lying with gold |
| Hosted roots | hold and lock coin like any root; redeem after taking the key home | custody |

## 10. What this plan does not solve, and what it risks

- **One home.** Until it is bridged the coin is as decentralized as its home tracker. The home cannot forge a line or rewrite an anchored one; it can halt, refuse, and order the lines within a period. The mirror's copy and the continuation rule are the answer now; the door out is the answer later, for anyone who wants it. `COIN.md` says this in plain words.
- **Ordering within a period.** Two spends by one root against one balance: the home's order decides which stands. Vesting and locks make the order between a strike and a spend harmless; between two transfers it is the sender's own race.
- **Gold reaches only what an owner can answer in advance.** Everything else is verified by nothing yet; audits by sortition are the next number.
- **The wash.** An owner with a crowd of roots publishes gold they also answer, and mints. The owner's lock, the vendor rule on weights, and the fixed emission that a wash only dilutes are the bounds; none removes it.
- **Price.** While transfers are off there is no price. When they turn on there will be one, the protocol cannot bound it, and most tokens fall to the price of their float. Holding demand from locks and payers buying coin to pay are the supports.
- **Law.** A unit earned by work and transferable is a security to some regulators whether it lives in a ledger or on a chain. The founder decided on 27 October 2026 that transfers are on from genesis and that counsel reads the design as launched rather than before it; counsel still comes before the first contract. The design's answers (no sale, fixed emission, utility first) are arguments, not conclusions.
- **Gas.** None for anyone to work, earn, lock, pay or hold. A holder pays once to redeem; the poster's heads are the project's only recurring gas, and only once the door out exists.
- **Home coupling at the door.** A tracker that honours coin locks depends on the home for that one read; when the home is unreachable it admits standing locks and refuses coin locks with the reason, and the map is unaffected.
- **Availability.** A balance is reproducible only from receipts someone holds; the mirror holds every chain of the home and anchors it, and refuses a head it cannot reproduce.
- **The bridge's bond.** A posted head is bonded, not proven; the stamp lets anyone catch a lie and the veto strikes it; a proof of the layer is the later answer.
- **Attention.** A coin draws the people a coin draws, who will test every seam of the slashing; they are also its audit.

## 11. The first week, if the plan is taken

1. Phase 0's document edits, as one commit, so the repository argues one position before any code.
2. `docs/ext/QX-15.md` written in full, with its event table and refusals, before `challenge.ts` is touched.
3. `stake.test.ts` on the tracker, red; then the layer's `locked`, `free`, `admitLock`, `admitClaim`; then the door; then the offers; green.
4. The client's lock-then-claim and `quilt_me`; the client test green.
5. A demo on the scratchpad trackers: one staked problem, one fresh root refused, one root with standing admitted, the receipts read back.
