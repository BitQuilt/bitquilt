# @bitquilt/core

The BitQuilt core, version 1: what a client has to get right and nothing else. `docs/CORE.md` at the root of the repository is the document; this package is its reference implementation. Canonical JSON and hashes (`src/canonical.ts`, `src/hash.ts`), keys and signatures (`src/keys.ts`), the envelope and the piece hash (`src/envelope.ts`, `src/schema.ts`), the event line and the receipt wrapper (`src/events.ts`), the reducer (`src/reduce.ts`), the roots its fold keeps (`src/roots.ts`) and `next` (`src/next.ts`); beside them the plain-text gate (`src/gate.ts`), the stamp (`src/stamp.ts`) and the chained lines (`src/chain.ts`) of section 11 and the extensions, which the reducer ignores. Everything is pure: nothing here reads a clock, the network, a file or the environment (AGENTS.md, rule 2; `test/pure.test.ts` holds it), except the two scripts below. What it computes again and again it keeps, and a kept answer is the answer computed afresh: a signer by the signature and the hash of what it signs (`src/keys.ts`); and, for what a store hands out frozen through every level (`frozenThrough`), an event's id and signer (`src/events.ts`), an envelope's hash, faults, owner's signature and pieces (`src/envelope.ts`, `src/reduce.ts`); and a blob's hash for bytes their holder fixed (`fixedBytes`), since a non-empty typed array cannot be frozen; for a tracker folds every version of a chain, and the fold of each reads every version before it. What is not frozen through every level, or not fixed, may still be written to, so it is computed each time it is asked (`test/kept.test.ts`).

## The frozen rule

The wire is frozen and the reading is numbered (AGENTS.md, rule 1). CORE.md is reading 1, frozen as version 1: `reduce` and `next` answer the twenty-four fixtures as they stand, and no change to this package moves a state or a pick there. `fixtures/generate.ts` writes those fixtures from this implementation and is run only to add a clarification, as rule 1 says. Reading 2 is `docs/v2/READING.md`, a dated draft, and `read` is held to every fixture under `fixtures/reading-2`: a change that moves an answer there amends the document in the same pull request, says the fixtures again with `fixtures/say-again.ts`, and says which answers changed and why. Behaviour that moves no piece's state, no set and no standing goes in an extension (`docs/EXTENSIONS.md`).

## The scripts

- `bitquilt-conform` (`src/conformance.ts`; `pnpm conform` at the root): runs every fixture under a folder and prints `ok` or the differences for each, then a total. Against this library it is a test; against another implementation it is the definition of being a BitQuilt client. Given `fixtures/reading-2` it runs the fixtures of reading 2 through `read` (`pnpm conform:2` at the root).
- `bitquilt-verify` (`src/verify.ts`; `pnpm --filter @bitquilt/core verify`): given a problem's chained receipts and its hash, and optionally its envelopes and blobs, checks the chain and every signature against its key, then runs the reducer and prints the map. Clone and compute, with no trust in any site.

## The fixtures

`fixtures/` holds one JSON file per case, and `fixtures/README.md` describes the file: the envelopes with their ancestors, the blobs, the receipts, `now`, and what to expect. A client conforms when it reproduces every fixture's states, its count of dropped events, its `complete`, its output hash and its picks; the reasons the fixtures give for dropped events are this reference's wording and not part of conformance.

## A second implementation

`impl/python` at the root of the repository is the core written a second time, from CORE.md and the fixtures alone, with no sight of this code. That is how a second implementation is written: from the document and the fixtures, nothing else. Its `FINDINGS.md` records where the document was short, and section 12 of CORE.md now says what it lacked.

## Commands

```bash
pnpm --filter @bitquilt/core typecheck   # the source and the tests
npx vitest run packages/core
pnpm conform
pnpm conform:2
```
