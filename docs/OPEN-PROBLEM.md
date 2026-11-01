# Costless acceptance: an open problem

Stated 24 Oct 2026. Version 1 of BitQuilt ([CORE.md](CORE.md)) ships provenance and portability and says plainly that it does not ship correctness. This document states the gap as a problem, so that it can be attacked by anyone, and records what is known and what has been tried. A solution is an extension ([EXTENSIONS.md](EXTENSIONS.md)), never a change to the core.

## The setting

A problem is a file of pieces. A piece whose verifier is `agree` is accepted when two returns from unrelated roots of different declared model vendors agree on the fields the author named. A root is a secp256k1 key. Making one costs nothing. Every event is signed and kept; anyone can clone the ledger and compute the same map.

For a piece whose verifier is a machine (`check`, `score`), who signed does not matter much: the result can be reproduced by anyone who runs the check. For a piece whose verifier is agreement, who signed is the whole verifier, and two roots one person made agree with each other for free. Panels for disputes are drawn by sortition from roots with accepted work elsewhere; a crowd of free roots that accepted each other's work is in the pool.

## The problem

Design an acceptance rule for claims no machine can check, such that:

1. **The reducer reads no chain, and a worker with no coin is never shut out.** No coin, token, credit, bounty or fee is an input to the map, and no stake is the only way in: standing earned by work satisfies any stake a problem asks, and a problem that asks none is open to a key with nothing. (A coin that is a function of the ledger, bound to a root and admitted at a tracker's door, is an extension; it is not a solution to this problem. Until 26 Oct 2026 this condition read "No money inside the protocol"; the note at the end says what changed.)
2. **No identity anchored outside the protocol is required of a worker.** No government document, no biometric, no account with a company. A worker is a key.
3. **The cost of getting a wrong square accepted, and keeping it accepted, is bounded below** by something comparable to the cost of doing the piece honestly, against an adversary who can make any number of roots and coordinate them.
4. **Anyone can compute it from the ledger alone.** Clone and compute. No trusted party's word is an input, except as the design already admits (a tracker's receipt stamps).
5. **Honest newcomers are not shut out.** A key with no history can do its first piece and have it count for something.

A solution states its threat model (the adversary's budget in roots, work and patience, and what colludes with what), shows under it, by proof or by simulation on the reference fixtures, that condition 3 holds, says how condition 5 is met, and conforms to the core as an extension.

## Why the known answers do not fit

- **Money.** Bitcoin's contribution was cost without identity, and it bought that cost with a coin. On 24 Oct 2026 the project decided that a coin inside BitQuilt would make BitQuilt about the coin, and condition 1 recorded it; on 26 Oct it reversed that decision for a coin that is a layer over the ledger and a stake at the door ([COIN.md](COIN.md)). Money still does not solve this problem: a stake prices a wrong square only for the root that holds one, and condition 1 as it now reads keeps the way in open for a root that holds none.
- **Identity.** Proof of personhood (social graphs, pseudonym parties, biometrics) gives one key per person, at the cost of an anchor outside the protocol: a social network that already exists, a meeting, a device. Condition 2 refuses the anchor. Reputation computed inside the protocol (standing) is identity of a kind, and a patient adversary farms it.
- **Work.** Proof of work prices a root in CPU time and so prices a crowd of roots. It does not bound the cost of one wrong square, and a funded adversary pays it. BitQuilt admits it as a tracker's lever, not as a verifier.
- **Redundancy.** BOINC accepts a result when a quorum of volunteers agree, and assumes most volunteers are honest and compute the same thing. Here the failure is correlated error among copies of a model, which the vendor rule bounds, and collusion among free roots, which nothing bounds.
- **Stake and dispute games.** Truebit, optimistic rollups and Kleros make a wrong acceptance costly by making the acceptor lose a stake to whoever challenges. The stake is money, or standing, which is free to farm. BitQuilt now admits both at the door (QX-15) and calls neither a solution: the square of a worker who staked nothing is still the problem.
- **Peer prediction.** Mechanisms where honest reporting is an equilibrium without ground truth (Bayesian truth serum, the surprisingly popular answer) assume independent reporters paid by a score. They help with correlated error; they say nothing about an adversary who controls many reporters.

## What is known about BitQuilt's own ledger

One structural fact may be the start of an answer. An agreement edge between an honest root and an adversary's root costs the adversary a correct return, because an honest root agrees only when the return is right on the agree fields. Edges among the adversary's own roots are free; edges into the honest region cost honest work. This is the same asymmetry that SybilLimit exploits in social graphs, where the adversary's region joins the honest region through few edges because every edge needs the honest side's consent. BitQuilt's agreement graph has that asymmetry by construction, and it is computable from the ledger alone.

## Directions

Candidate attacks on the problem, none proven, in the order the maintainers would try them.

1. **Independence from the agreement graph.** Compute per root how much of its accepted work was agreed by roots outside its own cluster (random walks in SybilLimit's manner, or a conductance measure). Weight standing by it; draw panels by it rather than by standing; show on every accepted square the independence of the pair that accepted it; let a pattern set a floor below which a square stays provisional and a third production is cut from an independent root. The adversary then buys influence only with correct work, which is what BitQuilt wanted from them. What this does not do: make a fresh pair's one self-accepted square costly. It makes that square visibly weak and worthless for influence.
2. **Blind agreement only.** Count an edge for independence only when both commits preceded both reveals, so that nobody earned an edge by copying a lone revealed return.
3. **Evidence a machine can check even when the claim cannot.** A verbatim quote with a page is cheap to check against the source and costly to fabricate convincingly: costly to produce, cheap to verify, in the small. Require every `agree` piece to carry at least one evidence field that a small verifier can check against a named source, and let anyone run it.
4. **Random audits by sortition.** Re-draw a fixed fraction of accepted squares for an independent production. When the loss from being caught is small, the probability of being checked is the deterrent.
5. **The surprisingly popular answer.** Each worker gives the verdict and a prediction of what others will say; the verdict more popular than predicted is likelier true. Against correlated error, not collusion.
6. **Attested work.** Inference in attested hardware, where a return carries proof that a named model ran the brief: cost without identity, native to the work. In 2026 this exists in a few deployments and several preprints; most signed receipts are logs, not proofs; the trust moves to the chip vendor. A reserved slot in the return, and a watch.
7. **Stake as an extension.** Taken, 26 Oct 2026: a problem may ask that a claim be backed by standing or by coin locked at the tracker's door, and a gold piece or a held challenge forfeits it ([COIN.md](COIN.md); QX-15 and QX-16). Allowed under condition 1's parenthesis; not a solution, since a worker without a stake must still count, and a problem that asks none is open to them.
8. **Age.** Standing that accrues only after a root has agreed with independent roots over weeks. Patience is a cost the adversary pays with time, and slows every attack without stopping one.

## What a solution would change

A solution is an extension that defines a function of the ledger and a rule for `accepted_provisional` that uses it. The core does not change: a core client still computes the same coarse state, and the extension's client computes a finer one. The fixtures gain planted adversaries: a pair, a triad, a farm of twenty roots with a handful of honest edges, each with the state a conforming extension must produce.

## The smallest experiment

Replay fixture ledgers with planted clusters through a prototype of direction 1. Check that the adversary's self-accepted squares score low, that honest squares with few agreements score fairly, and how an honest newcomer looks before it has edges. Then write direction 1 as an extension and measure it on the first standing problem.

## Status

Open. Version 1 ships provenance and says so. Whoever closes this for AI work has done something BitQuilt did not, and BitQuilt will carry their extension.

## A note of 26 October 2026

Condition 1 was written "No money inside the protocol" on 24 October, as a decision of the project and not a finding. Two days later the project reversed it, for this reason: the stake this problem needs was already at the tracker's door, where a challenge is admitted only if the challenger's standing covers it (QX-1), and a coin bound to a root and admitted at that same door is what the condition's own parenthesis allowed. The reducer still reads no chain, the core and its fixtures are untouched, and a worker who holds nothing still has a way in, which is what the condition was protecting. The coin is a layer over the ledger, computed from receipts as standing is, with a chain only as a door out of it, later; [COIN.md](COIN.md) is the design. Direction 7 is the direction taken. The problem stays open: a stake prices a wrong square for the root that holds one, and says nothing about the square of a worker who staked nothing.

## A note of 1 November 2026: proving the vendor

The independence rule rests on a declaration. A reveal says `anthropic/claude` or `openai/gpt-6-luna`, and nothing checks it: two keys one person holds can declare two vendors and accept each other's squares for free, which is the attack this document names. Three ways to make the declaration cost something, from the strongest to the one that reaches the most people.

**zkTLS, for work done through a vendor's API.** Nearly every call to a model's API goes over TLS, and a zkTLS proof lets the caller show that a particular HTTPS request was made and a particular response came back, without giving up the session or the key. For a return, that is a proof that the text came from `api.anthropic.com` or `api.openai.com` with the model named in the request. It exists: Reclaim Protocol's `zkFetch` carries an open-source model router whose README says it "Currently supports Anthropic, OpenAI and Google (soon)" and gives "proofs of correct model being called", and Primus Labs and Opacity describe the same shape for any API call (checked 1 November 2026). Its limits are the ones to write on the square. It covers a paid API call and nothing a person does through a subscription, so none of the people Quilt is for. It proves the one call that produced the answer, not the reading before it, so a worker can still fetch the answer elsewhere and have the named model repeat it. And in every practical form a notary, a proxy or an attestor sits in the TLS session and could collude with the prover, so the trust moves from the vendor's word to the notary's. In BitQuilt it is direction 6's reserved slot filled in: an extension that names a `proof` field on the reveal and its shape, which a tracker verifies at the door and anyone verifies from the ledger; a reveal that carries one declares its vendor as proven; the `examples/` workers and the houses would carry one from the day a router does.

**The product as witness, for the people in the Claude app or ChatGPT.** A person in claude.ai cannot make such a proof: there is no API call of theirs to prove, since the product makes the calls. What there is instead is the door they come in by. claude.ai reaches a remote connector from Anthropic's own servers, and where the connector asks for OAuth, the authorization code is sent to the callback the product registered (claude.ai's, chatgpt.com's) and the token is exchanged by that product's backend; a client that registers any other callback gets a token marked as that client. A tracker whose hosted on-ramp is the authorization server for its own addresses therefore sees which product each session's token came through, and can write `via: claude.ai` on every event it posts for that member, the way it writes `custody: hosted` today. A token obtained through claude.ai's callback was obtained by Anthropic's servers, and that product runs one vendor's models. What it attests is that the product made the calls. What it does not: the person can type the answer and have the product hand it back; the local connectors (Claude Desktop and Claude Code over stdio) have no witness, since any process may name itself in the handshake; and the mark is the tracker's word, as `human` already is. The cost is OAuth with dynamic client registration and PKCE on the hosted on-ramp, a `via` field on the hosted events, and the independence rule reading it: a day or two. The first two were built the same day as [QX-18](ext/QX-18.md), with one thing the note had not seen: the code passes through the person's browser on its way to the product's callback, so the callback alone proves little, and the on-ramp hands the token over only to the product, by the key ChatGPT publishes or from the addresses Anthropic publishes for claude.ai's servers. Its section 4 says what that rests on. The independence rule does not read the mark yet.

**Three grades of a vendor, shown on the square.** Proven (zkTLS, or attested hardware when it comes), witnessed (a product the tracker saw), declared (the reveal's word alone). The reducer stays as it is. An extension computes the grade of the pair that accepted a square; a pattern may set a floor, below which `next` cuts a third production from a better-graded root and the square stays provisional; standing may weight by it. This is direction 1's independence read at the door rather than from the graph, and the two compose: a pair that is both witnessed and independent on the graph is the strongest square the ledger can show without proof.

## Reading

SybilLimit (Yu, Gibbons, Kaminsky, Xiao, 2008); the Sybil defenses survey (arXiv 1312.6349); Hashcash (Back, 1997); BOINC (Anderson, 2004); Truebit (Teutsch and Reitwießner, 2017); Kleros (2018); Bayesian truth serum (Prelec, 2004) and the surprisingly popular answer (Prelec, Seung, McCoy, Nature 2017); on attested inference, the 2026 preprints on gateway-path provenance (arXiv 2606.22560) and TEE-sealed routers (arXiv 2606.16358); on what happens when reputation is anchored and semantics are not, the ERC-8004 study (Xiong et al., arXiv 2606.26028).
