# The wire

Status: frozen 11 November 2026. This is the first of the two documents of version 2 of the core; the second is [READING.md](READING.md), a draft. [The plan](../history/V2-PLAN.md) says why there are two and the order they are built in. Since the switch the plan's phase 6 names, 11 November 2026, the reference tracker reads these bytes by reading 2. [CORE.md](../CORE.md) says the same bytes and reading 1, and nothing here changes it.

**Abstract.** The wire is the bytes a person's key signs and a resolver keeps: the forms, the envelope, the piece hash, the event line, the receipt, the chained line and the link. It is frozen as it stands. A hash made today names the same bytes for good, and a signature made today recovers the same key for good. What those bytes mean, which pieces have a square and who has standing, is the reading, which carries a number and may change without changing a byte of the wire.

## 1. What the wire is

Each part keeps the home it has. This document copies none of them, so a rule has one text and the code's citations stand.

| Part | Its home |
| --- | --- |
| Canonical JSON, the hash, keys and signatures | [CORE.md](../CORE.md) section 1 |
| The envelope, its checks and the closed schema subset | CORE.md section 2 |
| The piece hash and the brief | CORE.md section 3 |
| The event line, an event's id, and the body of each core type | CORE.md section 4 |
| The receipt wrapper, and how wrappers merge | CORE.md section 5 |
| The link | CORE.md section 8 |
| Admission: the gate and the stamp | CORE.md section 11 |
| The chained line, the logs, appending, the head, and reading a chain | [QX-11](../ext/QX-11.md) sections 1 to 5 |

The clarifications of CORE.md section 12 that read these sections are the wire's, as written.

## 2. What frozen means

- No change to the meaning, the bytes, the hash, the signature or the order of anything in section 1.
- No input added to the piece hash or the problem hash.
- An envelope says `"quilt": 1` as it does now. That number is the wire's, and reading 2 reads it.
- Every receipt on every chain a resolver keeps is read as it was written. None is rewritten and none is published again.

## 3. What the wire leaves to the reading

- Which events count, and for which root: CORE.md section 6 under version 1, [READING.md](READING.md) under version 2.
- The state of a piece, the sets, standing, and what `next` hands a key.
- The body of a type the core does not list. The event line is the wire's, and a new type is a new body on the same line; the reading says which types it reads and what each body holds.
- The words a resolver adds to a receipt's wrapper beyond `received`. The wrapper's form is the wire's; what a word such as `custody` means is the reading's.

## 4. What stays beside both

What a tracker does at its door and what a keeper does with a chain are neither the wire nor the reading: seeding and the order of the offer (QX-4, QX-5), the hide (QX-6), the witness (QX-18), anchoring (QX-12), the announce and the relays (QX-13, QX-14), the peers' pull (QX-21), and the coin with its door out (QX-17, QX-11 section 7). [EXTENSIONS.md](../EXTENSIONS.md) keeps their registry.
