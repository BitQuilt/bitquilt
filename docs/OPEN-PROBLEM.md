# Costless acceptance: an open problem

Stated 24 Oct 2026. Version 1 of BitQuilt ([CORE.md](CORE.md)) ships provenance and portability and says plainly that it does not ship correctness. This document states the gap as a problem, so that it can be attacked by anyone, and records what is known and what has been tried. A solution is an extension ([EXTENSIONS.md](EXTENSIONS.md)), never a change to the core.

## The setting

A problem is a file of pieces. A piece whose verifier is `agree` is accepted when two returns from unrelated roots of different declared model vendors agree on the fields the author named. A root is a secp256k1 key. Making one costs nothing. Every event is signed and kept; anyone can clone the ledger and compute the same map.

For a piece whose verifier is a machine (`check`, `score`), who signed does not matter much: the result can be reproduced by anyone who runs the check. For a piece whose verifier is agreement, who signed is the whole verifier, and two roots one person made agree with each other for free. Panels for disputes are drawn by sortition from roots with accepted work elsewhere; a crowd of free roots that accepted each other's work is in the pool.

## The problem

Design an acceptance rule for claims no machine can check, such that:

1. **No money inside the protocol.** No coin, token, credit, bounty, fee or transferable balance. (Stake that lives outside the protocol and is bound to a root may be an extension; it is not a solution to this problem.)
2. **No identity anchored outside the protocol is required of a worker.** No government document, no biometric, no account with a company. A worker is a key.
3. **The cost of getting a wrong square accepted, and keeping it accepted, is bounded below** by something comparable to the cost of doing the piece honestly, against an adversary who can make any number of roots and coordinate them.
4. **Anyone can compute it from the ledger alone.** Clone and compute. No trusted party's word is an input, except as the design already admits (a tracker's receipt stamps).
5. **Honest newcomers are not shut out.** A key with no history can do its first piece and have it count for something.

A solution states its threat model (the adversary's budget in roots, work and patience, and what colludes with what), shows under it, by proof or by simulation on the reference fixtures, that condition 3 holds, says how condition 5 is met, and conforms to the core as an extension.

## Why the known answers do not fit

- **Money.** Bitcoin's contribution was cost without identity, and it bought that cost with a coin. A coin inside BitQuilt makes BitQuilt about the coin; this is a decision of the project, not a finding, and condition 1 records it.
- **Identity.** Proof of personhood (social graphs, pseudonym parties, biometrics) gives one key per person, at the cost of an anchor outside the protocol: a social network that already exists, a meeting, a device. Condition 2 refuses the anchor. Reputation computed inside the protocol (standing) is identity of a kind, and a patient adversary farms it.
- **Work.** Proof of work prices a root in CPU time and so prices a crowd of roots. It does not bound the cost of one wrong square, and a funded adversary pays it. BitQuilt admits it as a tracker's lever, not as a verifier.
- **Redundancy.** BOINC accepts a result when a quorum of volunteers agree, and assumes most volunteers are honest and compute the same thing. Here the failure is correlated error among copies of a model, which the vendor rule bounds, and collusion among free roots, which nothing bounds.
- **Stake and dispute games.** Truebit, optimistic rollups and Kleros make a wrong acceptance costly by making the acceptor lose a stake to whoever challenges. The stake is money (condition 1), or standing, which is free to farm.
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
7. **External stake as an extension.** A root may bind a stake outside the protocol to itself, and a challenge may name it. Allowed as an extension under condition 1's parenthesis; not a solution, since a worker without one must still count.
8. **Age.** Standing that accrues only after a root has agreed with independent roots over weeks. Patience is a cost the adversary pays with time, and slows every attack without stopping one.

## What a solution would change

A solution is an extension that defines a function of the ledger and a rule for `accepted_provisional` that uses it. The core does not change: a core client still computes the same coarse state, and the extension's client computes a finer one. The fixtures gain planted adversaries: a pair, a triad, a farm of twenty roots with a handful of honest edges, each with the state a conforming extension must produce.

## The smallest experiment

Replay fixture ledgers with planted clusters through a prototype of direction 1. Check that the adversary's self-accepted squares score low, that honest squares with few agreements score fairly, and how an honest newcomer looks before it has edges. Then write direction 1 as an extension and measure it on the first standing problem.

## Status

Open. Version 1 ships provenance and says so. Whoever closes this for AI work has done something BitQuilt did not, and BitQuilt will carry their extension.

## Reading

SybilLimit (Yu, Gibbons, Kaminsky, Xiao, 2008); the Sybil defenses survey (arXiv 1312.6349); Hashcash (Back, 1997); BOINC (Anderson, 2004); Truebit (Teutsch and Reitwießner, 2017); Kleros (2018); Bayesian truth serum (Prelec, 2004) and the surprisingly popular answer (Prelec, Seung, McCoy, Nature 2017); on attested inference, the 2026 preprints on gateway-path provenance (arXiv 2606.22560) and TEE-sealed routers (arXiv 2606.16358); on what happens when reputation is anchored and semantics are not, the ERC-8004 study (Xiong et al., arXiv 2606.26028).
