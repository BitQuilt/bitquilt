# An audit of the coin's shape

Written 28 October 2026 at the founder's request, from [COIN.md](COIN.md), [COIN-PLAN.md](COIN-PLAN.md), [OPEN-PROBLEM.md](OPEN-PROBLEM.md), [ext/QX-1.md](ext/QX-1.md), [ext/QX-15.md](ext/QX-15.md), [ext/QX-16.md](ext/QX-16.md), [ext/QX-17.md](ext/QX-17.md), the draft parameters in [LAUNCH.md](LAUNCH.md) and the layer as `packages/tracker/src/coin.ts` computes it. Two questions were asked: whether standing and the coin should stay two things or become one, and what the emission schedule should be. This document changes nothing; every number in it is a parameter of QX-17 or a tracker's policy, and every change it suggests is the founder's to make. The core and its fixtures are untouched by any of it.

The short answers. Keep two things, and fix the two places where the design blurs them: the words the person sees, and the price of a burn. The draft emission mints a quarter of all coin ever in its first year, pays a square in a quiet day ten thousand times what it pays in a busy one, and runs down to nothing; a gentler curve, a cap on what one square can earn, and a tail would each be an improvement, and the second bends one of the plan's six commitments, which is named below so it is argued and not slipped past.

## 1. Two things, or one

### What each is

| | Standing (QX-1, QX-15) | Coin (QX-17) |
| --- | --- | --- |
| Earned by | every reveal of the root in an accepted set, plus one; a held challenge, plus its stake | a verified square, a gold match, pro rata within its epoch; payments and transfers received |
| Supply | unbounded; one point a reveal, for ever; it does not decay | capped each epoch by the published curve |
| Transferable | no; it follows the root through rotation and goes nowhere else | yes, from genesis |
| Bought | one way only, by burning coin at the tracker's own rate | yes |
| Lost by | a struck set (minus one and the lock); a failed challenge (the stake) | a forfeit (the lock and as much again unvested); a burn; a payment |
| Backs | a challenge; a claim on a staked piece; the owner's gold | a claim on a staked piece, at the burn rate; a bounty; a transfer; a redeem |
| Answers the question | has this root done work here that stood? | will this root lose something if the square is wrong? |

### Why two

1. **They answer different questions, and a problem's owner may ask either.** A worker with history and no money passes the first; a worker with money and no history passes the second, through a burn; a problem that asks neither is open to a key with nothing. Fold the two into one and one of those doors closes. Fold them into coin alone and the free way in closes with it, which is condition 1 of the open problem and the sentence "not a gate" in COIN.md. Fold them into standing alone and there is no wage and no bounty, which is the position of 24 October that 26 October re-argued and reversed.

2. **They are tied to two different strengths of evidence.** Accepted means two roots agreed, and roots are free, so agreement is cheap; that is the open problem. Verified means the owner knew the answer in advance and the workers found it. The design puts the transferable, scarce thing on the stronger evidence and the unbounded, untransferable thing on the weaker. Merge them and one of two things happens: coin is minted for accepted squares, and two free roots agreeing on their own problem is a mint; or standing is earned only for verified ones, and most work, on the problems whose owners know no answers, earns nothing, so the stakes a problem can ask and the challenges a root can afford both starve.

3. **They need two different kinds of scarcity.** Standing is additive: a point earned by one root dilutes nobody's, which is the right shape for a record of work. Coin is zero-sum within an epoch: a square verified by one root takes from the shares of every other, which is the right shape for a currency with a fixed emission. One number cannot be both.

4. **This is how every proof-of-useful-work system is shaped.** Bitcoin has hashpower and bitcoin; Filecoin has storage power and FIL; Helium has coverage and HNT. The measure of work is never the thing that moves. Where money was let into the reputation seat it went the same way each time: Steem's purchasable Steem Power turned curation into vote buying, and Kleros's jurors drawn by stake made wealth the judge. The argument for an untransferable record beside a transferable token is the one made under the name "soulbound" (Weyl, Ohlhaver and Buterin, 2022). BitQuilt's standing is unusual only in persisting: hashpower is a flow, standing is a stock. That is a reason to weigh it (direction 1 of the open problem), not to merge it.

5. **It keeps the record of work out of the token's questions.** A unit that cannot be sold is not a security to anyone. A standing that were coin would carry the coin's questions into every challenge and every claim.

### What one would cost

- *Coin only.* The challenge stake and the claim stake become coin. A new root cannot challenge a wrong acceptance without coin, so the one defence the core has against a cheap agreement is priced in money. Fails condition 1.
- *Standing only.* No wage, no bounty, no door out. Reversed on 26 October for reasons recorded in COIN.md; not re-argued here.
- *Standing as a function of coin* (held, or burned). Reputation becomes purchasable at a rate, which is Steem's design. Fails condition 1 in effect.

### What two costs, and what to change

**The words.** Seven words meet the person at once: standing, locked, free; coin, vested, locked, escrowed, free. The founder's own question is the evidence that they do not explain themselves. The fix is wording, not design: say beside standing that it is earned by work and cannot be sold, and say "transferable now" where the sheet and `quilt_me` say "vested", since that is the only thing vesting decides for the person. One line each in `packages/client/src/tools.ts` and the sheet.

**The burn price.** The burn is the one leak between the two things: coin buys standing, one way, at the tracker's rate. The draft rate is a thousand units a point. Under the draft emission a day's minting after the treasury's share is 900,000 units, so one square verified alone in its day buys its two workers 450 points each, where a point by work is one accepted square. In the first weeks, money buys the record of work hundreds of times cheaper than work earns it, which is the one thing having two concepts was meant to prevent. The burn is a tracker's policy and not the protocol's, so this is a number to change, not a rule: price a point near what a verified square earns, by indexing the rate to the previous epoch's payout per unit of weight with a floor, or set it at a coin a point for the first year.

**Standing's own weakness** is the open problem's: a self-agreeing pair farms it on a problem of its own, and it never decays. That argues for weighting standing by the independence of the roots that agreed (direction 1), not for merging it with the coin. Noted and not pursued here.

**Verdict.** Keep two. Change the words and the burn price.

## 2. The emission schedule

### The draft

The parameters as LAUNCH.md drafts them and the home at `localhost:3977` runs them today:

| Parameter | Draft | Meaning |
| --- | --- | --- |
| `epoch_h` | 24 | a square pays within a day |
| `emission.per_epoch` | 1,000,000 units | one coin a day in the first year |
| `emission.decline_bp` | 2500 | the day's amount falls by a quarter |
| `emission.period_epochs` | 365 | once a year |
| `infra_bp` | 1000 | a tenth of each day to the treasury |
| `vesting_h` | 168 | a week from each minting to transferable |
| `weights` | 2 / 1 / 0 | cross-vendor, same-vendor, attest; one line per root of the set |
| `burn_rate` | 1000 units | a point of standing at the door |
| an empty epoch | mints nothing, carries nothing | supply is path-dependent |

### What it does, in numbers

Ceiling, if every epoch has a verified square: 365 / 0.25 = 1,460 coins, ever. Half of it by year 2.4.

| By the end of year | Share of the ceiling minted (draft, −25% a year) | Bitcoin, for comparison | Alternative, −12.5% a year |
| --- | --- | --- | --- |
| 1 | 25.0% | 12.5% | 12.5% |
| 2 | 43.8% | 25.0% | 23.4% |
| 4 | 68.4% | 50.0% | 41.4% |
| 5 | 76.3% | 56.3% | 48.7% |
| 10 | 94.4% | 81.3% | 73.7% |

The wage of one cross-vendor square (four units of weight: two roots, two each), after the treasury's share, by how many such squares its day had:

| Verified squares that day | Units to the square | To each worker |
| --- | --- | --- |
| 1 | 900,000 | 0.45 coin |
| 10 | 90,000 | 0.045 coin |
| 100 | 9,000 | 0.0045 coin |
| 1,000 | 900 | 0.00045 coin |
| 10,000 | 90 | 0.000045 coin |

### Findings

1. **It is front-loaded, twice as much as Bitcoin's.** A quarter of all coin ever is minted in the year with the fewest participants, no audits by sortition, the youngest detection and the founder's own patterns as most of the gold. The design's clawback (a forfeit takes as much again from the unvested) is a week long; front-loading puts the coin that matters in the year when fakes are least likely to be caught. Later, when audits by sortition widen "verified" to a sample of all accepted work, the base that can earn the emission grows; more of the coin should be minted then, not before.

2. **A square's wage swings ten thousandfold with the day's crowd.** Pro rata within a fixed daily amount is how a mining reward behaves, and for hashpower that is fine. Here the unit is a piece of useful work, and the swing means the best days to verify are the quiet ones. In the first weeks the quiet days belong to whoever holds gold problems and two keys declaring two vendors, which is the founder, and any ring that turns up.

3. **It runs down to nothing.** A quarter off each year, floored, reaches zero units a day around year 49 and is negligible long before. COIN.md says the coin is a stake and a wage and is not the point; a wage that ends makes the coin about holding it. The payments workers earn on accepted squares are the long-run wage by design, but they presuppose coin in payers' hands, and the emission is the only source when nobody pays. Verified squares are also what catch fakes; paying for them for ever keeps the audit incentive alive.

4. **The treasury's rule is not yet published.** A tenth of each epoch to a root the maintainers hold, "which pays the home tracker and the mirrors by a published rule": the share is within precedent (Zcash's founders' reward was a fifth for four years, then a fifth again as a dev fund), the perpetuity is the unusual part, and the rule itself does not exist yet. Publish it before genesis, and date a review of the share.

5. **Vesting covers the launch patterns' windows and nothing promises it covers others.** The twenty-seven example patterns set challenge windows of 48 or 72 hours; a week of vesting covers either, plus a panel's time. A pattern may set any window, and the home admits it today; a window above about 120 hours leaves a fake's coin vested before a late challenge decides. A home policy that admits a pattern only where its window plus two days is within the vesting period would make the guarantee hold for every pattern, not only the first ones.

6. **The weights bound correlated error, not collusion.** Vendors are declared, and declaring is free, so a ring declares two. The weights are right for what they are for (two copies of one model agreeing is weaker evidence than two models agreeing) and do nothing against a pair that lies together. That is the open problem; the schedule cannot fix it, and this audit does not pretend it can.

7. **The burn price**, found in section 1, is also an emission question: at a thousand units a point, the first day's emission is worth about nine hundred points of standing to whoever mints it.

### What a ring does with the draft

A ring is one person with an owner key, gold on a problem of their own, and two worker keys declaring two vendors. It verifies its own gold and takes the day's emission less whatever honest squares share it. Under the draft, its best days are the launch days, when it may be alone; its take is bounded by the epoch's amount, which is the one thing the fixed emission does well. A cap on what a square can earn in an epoch (below) turns the ring's windfall into a wage per fake, so that minting more means faking more, each fake costing gold stake in standing and leaving the trail direction 1 would read. No schedule makes a fake cost more than it pays while roots are free; that remains open.

### A revised draft

| Parameter | Revised | Why |
| --- | --- | --- |
| `epoch_h` | 24 | unchanged |
| `emission.per_epoch` | 1,000,000 units | unchanged; the absolute number is a unit of account |
| `emission.decline_bp` | 1250 | an eighth a year; half the ceiling by year 5.2, close to Bitcoin's four |
| `emission.period_epochs` | 365 | unchanged |
| `emission.floor_per_epoch` (new) | 100,000 units | a tail at a tenth of the launch rate, reached around year 17; after that the yearly inflation is about 1.4% and falls for ever |
| `emission.max_per_weight` (new) | the founder's; for example 5,000 units | an epoch mints the lesser of its curve amount and this times the epoch's verified weight, the treasury's tenth taken from that; a cross-vendor square then earns at most 18,000 units after the share (9,000 a worker), and a day saturates at 50 such squares; the rest is unminted, not carried |
| `infra_bp` | 1000 | unchanged; publish the payout rule and date a review |
| `vesting_h` | 168 | unchanged, with a home policy admitting a pattern only where its challenge window plus 48 hours fits inside it |
| `weights` | 2 / 1 / 0 | unchanged |
| `burn_rate` | indexed: the previous epoch's payout per unit of weight, floored at 100,000 units | a point costs about a square; a tracker's policy |

Ceiling under the revised curve before the tail: 365 / 0.125 = 2,920 coins; the tail adds 36.5 a year after year 17. With the cap, the actual supply is lower than the ceiling for as long as the network is thin, and that is the intent.

**The commitment this bends.** COIN-PLAN.md names six commitments "each of which, given up, is a reason to stop and re-argue", and one is "fixed emission, never a coin per square". A cap per unit of weight is a coin per square until the day saturates, and fixed emission after. The commitment's purpose, a bounded and dilutive supply that a crowd of fakes cannot inflate, survives: the curve is still the ceiling, and nothing a ring does mints above it. Its letter does not. The choice is between the letter and findings 2 and 3; this audit recommends the cap and says so plainly so that it is a decision and not a drift. Without the cap, the tail and the gentler decline still stand on their own.

### What a change costs

Every one of these is a field of the parameters QX-17 section 1 publishes, computed in `epochAmount` and the mint division in `packages/tracker/src/coin.ts`, recomputed by the mirror from the same receipts. Before the home's genesis a change costs nothing. After it, a change is a new version of the layer every reader can see; the history already minted stands, and the mirror reproduces both halves. The two new fields need a line each in QX-17, the shape check in `env.ts`, the mint in `coin.ts`, the mirror's reproduction and a test for each: an afternoon.

## 3. Decisions for the founder

1. Keep standing and the coin as two things. (Recommended: yes.)
2. Reword the sheet and `quilt_me`: "earned by work, cannot be sold" beside standing; "transferable now" for vested.
3. Set the burn price near a square's worth, indexed or a coin a point for the first year.
4. Soften the decline to an eighth a year, or another figure between Bitcoin's and the draft's.
5. Add a tail, and its rate.
6. Add a cap per unit of weight, knowing it bends the fifth commitment's letter, or decline it and keep the windfall.
7. Publish the treasury's payout rule and date a review of the share.
8. Add the home policy on windows against vesting.
