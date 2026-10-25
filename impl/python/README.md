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

## Score

24 of 24 fixtures pass. `22-complete-with-output` reproduces its states, its
`complete` and its pick, and not its output hash: CORE.md says what the
output document contains and not its shape (FINDINGS.md, finding 1).

After the findings were read, CORE.md gained the sentences it lacked (its section 12) and one fixture for verifies-first; with the output document's shape written down, this implementation reproduces all 24 fixtures.
