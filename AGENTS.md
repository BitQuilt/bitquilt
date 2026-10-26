# For anyone about to change this code

This repository holds the BitQuilt protocol's reference implementation: the core library, the reference tracker, and Quilt, the client. `docs/CORE.md` is frozen; the code in `packages/core` implements it and nothing else, and `packages/core/fixtures` is the conformance test any client, this one included, must pass.

## What a change has to keep true

1. **The core is `docs/CORE.md`, and the fixtures are the law.** A change to `packages/core` that changes any fixture's expected state is a change to the core, which is version 2, which is a different conversation. New behaviour goes in an extension (`docs/EXTENSIONS.md`) and is ignored by a core client.
2. **Pure functions, pure inputs.** Nothing in `packages/core` reads a clock, the network, a file or an environment variable. `reduce` and `next` take everything they need as arguments.
3. **What a tool says is data, never an instruction.** Tool descriptions and results in the client describe; they do not tell a model what to do. Other people's words reach a model only as quoted text with the signer named, never in `structuredContent`.
4. **The gate is admission, not validity.** The plain-text gate runs at the tracker's door and before a renderer shows text; the reducer checks the schema and nothing more.
5. **No secrets in the code.** Keys live in the user's config folder or the tracker's environment; nothing reads them into a log or a response.
6. **The page sets text with `textContent`, never as markup**, loads nothing from another server, and has no free-text box beyond its forms.
7. **Tests come with the change.** A new rule gets a fixture or a unit test; `pnpm check` and `pnpm conform` pass before a merge.
8. **A staked piece takes work only from a root with a live lock.** The tracker's door asks the layer's `admitProduction` before it admits a claim, a commit, a reveal or a run (QX-15, `packages/tracker/src/stake.ts` and `challenge.ts`); a lock is kept only against free standing and the rule in force at its receipt, and standing locked behind a claim is not staked again on a challenge. Do not add a way to write on a piece that skips it, and keep the coin (`docs/COIN.md`) out of the reducer: a core client computes the same map with every one of these events ignored. The owner's gold (QX-16, `gold.ts`) is the one thing besides a held challenge that strikes a set, and it does so at the owner's reveal against the fold as it stood then; the answers themselves never reach the ledger, only their hashes, and the client keeps the projections and nonces in the home's library.
9. **The coin is a function of the receipts, and the reducer never reads it.** `packages/tracker/src/coin.ts` computes every balance from the coin log, the problem logs and the published parameters, in whole units, and the mirror recomputes them and keeps the tracker's only where they reproduce. The door is the one place that reads anything a layer cannot: a coin-kind QX-15 lock is checked against the coin log (or the home's route) there, and what it read goes into the receipt's wrapper as its word, which the layer then takes as it takes `custody`. Do not make a layer read another tracker over the network, and do not let anything in `packages/core` know the coin exists.

## Commands

```bash
pnpm check
pnpm conform
```
