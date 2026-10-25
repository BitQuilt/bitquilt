# QX-6: the hide event and a maintainer's key

Status: Draft. Written and first implemented 27 October 2026 in the reference tracker (`packages/tracker/src/hide.ts`), the Quilt client and the mirror job. [EXTENSIONS.md](../EXTENSIONS.md) says what an extension may do; [PROTOCOL.md](../PROTOCOL.md), Events and Governance, names this one.

**Abstract.** A tracker is someone's, and what it serves is their word as much as their ledger. The protocol gives a tracker's keeper one power over what they show and none over what happened: a signed `hide` names a problem or an event and says why, and the tracker leaves that thing out of its own pages. The reducer never sees the event, the chain keeps every line, the mirror copies the hide with everything else, and another tracker honours it or does not. A person who wants the problem anyway asks for it by hash and gets it.

## 1. The event

| Type | Body | Valid when |
| --- | --- | --- |
| `hide` | `{ id, why, on? }` | `id` is an event id or a problem hash. `why` is text of at most 200 characters through the plain-text gate. `on` is true or absent to hide, false to lift. The event names no problem and goes to the identity log. |

A tracker takes a `hide` only from one of its **maintainers**, the keys it was started with (`QUILT_MAINTAINERS`, published at `/.well-known/quilt`), and refuses any other at the door. A hide by a key that is a maintainer nowhere is a well-formed event nobody honours.

## 2. What stands hidden

For a reader holding an identity log and a list of maintainers: the hide events in receipt order, counting only those signed by a maintainer on the list, with the latest hide or lift per `id` winning. The list is read each time, so a maintainer struck from it takes their hides with them.

## 3. What the reference tracker does with a hidden problem

- Leaves it out of `/`, `/search` and `/offer`.
- Answers `410` to `/p/<hash>/next` and to any event posted under it: taken down here.
- Still serves `/p/<hash>`, `/p/<hash>/events`, `/p/<hash>/state` and `/p/<hash>/scrape`, the last two carrying `hidden: { by, why, at }`, so a person who has the hash sees the problem and sees that this tracker took it down and why.
- Lists every hide in force at `GET /hidden`, events and problems alike, for renderers that honour this tracker's word.

A hidden event changes nothing the tracker serves: the chain carries it. A renderer that trusts the maintainer shows it as taken down, with the reason, and a core client shows it as it is.

## 4. The client and the mirror

- `quilt hide <id or hash> <why>` signs a hide and posts it to the identity log of the client's trackers; `--lift` posts the lift. The tracker's answer says whether the key is a maintainer there.
- A problem opened from a tracker that has taken it down says so in its summary and on the page, with the maintainer's address and their reason, beside the map that is still computed from the chain.
- The mirror writes every hide in the identity log into `index.json` under the problem it names, by signer, whoever signed it; the reader of a mirror decides which signers to honour.

## 5. What this does not do

- It does not delete. The envelope, the blobs and every receipt stay on the tracker and in the mirror.
- It does not reach other trackers. Each honours its own maintainers.
- It does not touch the reducer. A hidden piece is accepted or not exactly as the chain says.

## 6. Tests

`packages/tracker/test/hide.test.ts` holds the door (a non-maintainer, a malformed body, a link in the reason, the wrong log), the hidden problem's absence from index, search and offer, the 410 on next and on events, the envelope and chain still served, the lift, the hide of a single event and its listing. `packages/client/test/hide.test.ts` holds the verb and the summary. `packages/mirror/test/hidden.test.ts` holds the index entry.
