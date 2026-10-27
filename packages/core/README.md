# @bitquilt/core

The BitQuilt core, version 1: what a client has to get right and nothing else. `docs/CORE.md` at the root of the repository is the document; this package is its reference implementation. Canonical JSON and hashes (`src/canonical.ts`, `src/hash.ts`), keys and signatures (`src/keys.ts`), the envelope and the piece hash (`src/envelope.ts`, `src/schema.ts`), the event line and the receipt wrapper (`src/events.ts`), the reducer (`src/reduce.ts`) and `next` (`src/next.ts`); beside them the plain-text gate (`src/gate.ts`), the stamp (`src/stamp.ts`) and the chained lines (`src/chain.ts`) of section 11 and the extensions, which the reducer ignores. Everything is pure: nothing here reads a clock, the network, a file or the environment (AGENTS.md, rule 2; `test/pure.test.ts` holds it), except the two scripts below.

## The frozen rule

CORE.md is frozen as version 1 (its section 10 and AGENTS.md, rule 1), and the fixtures are the law. A change to this package that changes any fixture's expected state is a change to the core, which is version 2, which is a different conversation. `fixtures/generate.ts` writes the fixtures from this implementation; running it to change what an existing fixture expects belongs to that conversation, and a fixture is added only for what the reference already computes, as `23-verifies-first` was on 26 October 2026. New behaviour goes in an extension (`docs/EXTENSIONS.md`) and is ignored by a core client.

## The scripts

- `bitquilt-conform` (`src/conformance.ts`; `pnpm conform` at the root): runs every fixture under a folder and prints `ok` or the differences for each, then a total. Against this library it is a test; against another implementation it is the definition of being a BitQuilt client.
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
```
