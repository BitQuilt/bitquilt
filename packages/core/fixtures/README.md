# The conformance fixtures

One JSON file per fixture, written by `generate.ts` from the reference implementation and read by any client that wants to know whether it conforms to [CORE.md](../../../docs/CORE.md). A client conforms when it reproduces every fixture's states, its count of dropped events, its `complete`, its output hash and its picks. `pnpm conform` runs the reference against them; `python3 impl/python/conform.py` runs the second implementation.

## The file

```json
{
  "name": "04-agreement-provisional-then-accepted",
  "description": "…",
  "envelopes": [ <the problem's envelope first, then its ancestors along prev in any order> ],
  "blobs": { "<sha256:…>": "<the blob's bytes, base64>" },
  "receipts": [ <receipt wrappers, section 5 of CORE.md, in any order> ],
  "now": "<the time the reducer is run at>",
  "expect": {
    "states": { "<piece name>": "<state>" },
    "dropped": [ "<the reference's reason for each dropped event>" ],
    "complete": false,
    "output": null,
    "picks": [ { "key": "0x…", "client": { "can": ["web"], "model": "anthropic/claude" }, "now": "…", "piece": "<piece name or null>" } ]
  }
}
```

- A piece is named `family/n` for a family, or by its key for a single piece (CORE.md, section 3).
- `dropped` is compared by count. The strings are what the reference says for each drop, kept so a reader can see why; another client words its own.
- `output` is the hash of the output document (CORE.md, section 6, Output), or null while the problem is not complete.
- Each pick runs `next` for that key and client at that time against the fixture's state; `piece` is the name it returns, or null for nothing.
- Receipt wrappers may carry `custody` and `seat`, or neither, and the chain fields of QX-11; the core ignores what it does not read.
- The fixtures' keys are the secp256k1 private keys 1 to 12 as 32-byte big-endian integers, with 9 the owner; their addresses are therefore known.
