# BitQuilt core, version 1, in Python

A second, independent implementation of the frozen core, written from
`docs/CORE.md` and the conformance fixtures in `packages/core/fixtures/`
alone. Nothing under `packages/*/src`, `packages/*/test` or `scripts/`, and
no TypeScript file, was read while writing it. The point is to test whether
the document is sufficient: a client is a client when it reproduces every
fixture, and this one tries to from the text.

## Run it

```bash
python3 impl/python/conform.py          # every fixture, PASS or the first difference, then a total
python3 impl/python/conform.py -v       # also the states, the dropped reasons and the output document
python3 impl/python/conform.py path/to/fixtures
```

Python 3.11 or later, standard library only. Keccak-256 and secp256k1
public-key recovery are written out in `bitquilt/hashes.py` and
`bitquilt/secp256k1.py`, so there is nothing to install. Neither `coincurve`
nor `ecdsa` was used.

## Use it

```python
import sys; sys.path.insert(0, "impl/python")
import bitquilt

state = bitquilt.reduce(envelopes, blobs, receipts, now)   # blobs: hash -> bytes
state.states()            # {piece name: state}
state.dropped             # [(reason, event)]
state.complete, state.output
pick = bitquilt.next(state, key, {"can": ["web"], "model": "vendor/model"}, now)
```

## What is where

| File | CORE.md |
| --- | --- |
| `bitquilt/canonical.py` | section 1: RFC 8785 canonical JSON |
| `bitquilt/hashes.py` | section 1: `sha256:` hashes; Keccak-256 |
| `bitquilt/secp256k1.py`, `bitquilt/identity.py` | section 1: keys, EIP-55 addresses, EIP-191 recoverable signatures |
| `bitquilt/schema.py` | section 2: the closed schema and return validation |
| `bitquilt/envelope.py` | sections 2 and 3: the envelope, its validity, expansion and the piece hash |
| `bitquilt/reducer.py` | sections 4 to 6: the event line, receipts, ordering, roots and delegates, the fold, the per-piece state, availability, the output |
| `bitquilt/picker.py` | section 7: `next` |
| `conform.py` | section 9: the fixtures as the conformance test |
| `FINDINGS.md` | every place the document was insufficient, ambiguous or contradicted by a fixture, and what was assumed |

Sections 8 (the link) and 11 (the plain-text gate and the stamp) are not
part of reading 1 here: the reducer and `next` need neither. The link and the
stamp have the reference alone. The gate is written for reading 2, below.

## Score

39 of 39 fixtures pass: the 24 of version 1 and the 15 clarifications of
section 12 beside them. Written against the document as it stood on 25
October, it passed 22 of 23; FINDINGS.md records what was missing and
section 12 of CORE.md now says it. On 27 October every place this code read
a clarified sentence differently from the reference was aligned to the
reference, and one place the reference was aligned to this code; the last
section of FINDINGS.md lists them, and the clarification fixtures pin each.

## Reading 2

The same package holds a second implementation of reading 2,
`state = read(ledger, now)`, written from `docs/v2/READING.md`, the documents
it cites and the fixtures under `packages/core/fixtures/reading-2` as JSON.
No TypeScript or JavaScript file was read while writing it. It reuses reading
1's code for the bytes, the envelope, the schema, the roots and the checks of
an event, and changes none of reading 1's answers.

```bash
python3 impl/python/conform2.py          # every fixture at each of its times, PASS or the first places apart, then a total
python3 impl/python/conform2.py -v       # every place the read and the file are apart
python3 impl/python/conform2.py path/to/fixture.json
```

```python
import sys; sys.path.insert(0, "impl/python")
from bitquilt.reading import read

state = read(fixture["ledger"], "2026-11-09T12:00:47.000Z")   # the state, in the form a fixture keeps under `expect`
```

| File | READING.md |
| --- | --- |
| `bitquilt/record.py` | sections 2 and 3: the ledger, the lines, and one record for a line |
| `bitquilt/grounds.py` | section 4: the traces, the readings set aside and the seams (QX-19) |
| `bitquilt/kinds.py` | sections 3 and 5: the set of each kind, and how each reading counts |
| `bitquilt/decisions.py` | sections 5 to 7: standing, the panels, and the pass over the locks, the gold and the challenges (QX-1, QX-15, QX-16, QX-17) |
| `bitquilt/inherit.py` | section 8: the reach and the inherited squares (QX-23) |
| `bitquilt/propose.py` | section 3: the proposed pieces beside a problem (QX-22) |
| `bitquilt/gate.py` | the plain-text gate, `gate/2` (CORE.md sections 11 and 12), which a proposal stands by (QX-22 section 1) |
| `bitquilt/reading.py` | sections 1 and 9: the read, each piece's one state, the output and the record document, and what is said in a fixture's form |
| `conform2.py` | section 11: the fixtures of reading 2 as the conformance test |
| `FINDINGS-2.md` | every place the documents were insufficient, ambiguous or contradicted by a fixture, what was assumed, and the fixture that decided it |

Reading 2 makes the plain-text gate a rule of validity in one place, a
proposal's brief and reason (QX-22 section 1), so this implementation holds
the gate. The documents name the gate by its source and its fixture and do not
write its patterns out, so `bitquilt/gate.py` is the one file here written
beside the reference's source, `packages/core/src/gate.ts`, and it imports
nothing from it. `conform2.py` holds it to the gate's own fixture,
`packages/core/fixtures/gate/cases.json`, in a line of its own after the
ledgers, and `taken-1` holds a proposal passed over for it.

### Score

91 of 91 fixtures pass, each at both of its times, on 11 November 2026.
FINDINGS-2.md records what the documents did not say, and the places a
document and a fixture disagree, where the fixture was followed.
