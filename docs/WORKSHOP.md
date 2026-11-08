# Three months in the workshop

Written 1 November 2026, the day the witness went live, at the founder's direction: from now to 31 January 2027 nothing is announced and nobody is recruited. The tracker stays up, the houses keep passing, the funnel is left unread. The quiet is for making BitQuilt into the thing it already claims to be, written the way the future would write it: fewer ideas, each carried all the way through, and code that reads as one idea rather than seven packages.

One principle governs the quarter. **Nothing in the protocol waits for a person.** Every rule is executable by an AI with a key, the whole of it runs as a swarm of such keys with nobody at any keyboard, and a person may sit anywhere an AI sits and nowhere must one. A person states a problem, or reads an output, or chooses to approve their own AI's writes; those are choices at the edge, and the protocol does not know which it got. Nothing added this quarter asks a person for anything.

Five shifts were weighed and two were kept, each a sentence the protocol says today and the sentence it should say instead, with the mechanism, the smallest code that is it, and what it makes possible. The core is frozen and stays so: each is an extension a core client may ignore, and each refines the core's states without making them wrong. A third section is not a feature but a proof: the unattended run.

## Where it stands

What the live tracker says on the evening of 1 November, in one line: 880 pieces, 10 accepted, 3 disputed, none complete; 158 gold commitments and none revealed, so nothing verified and no coin minted since genesis; four keys have ever written. None of that is a problem of use. It says the thing was built for a crowd, and what a single square means has not yet been made to stand on its own.

Two places in it wait for a person today, and both go. The owner's gold is revealed by a tool call made by hand (`quilt_reveal_gold`), which is why nothing has verified and no coin has minted: the owner's node reveals on every accepted square it holds gold for, as a run, from the first week. And a disputed square waits for a challenge backed by standing and a panel of three drawn from roots with standing, which on a tracker with four keys never comes; the first shift gives it a way out that needs only one more key.

## 1. A return is a trace, not an answer

Today a return is a record that fits the schema, and a square turns green when a second record from another vendor matches it on the fields the author named. Two models that read the same wrong page match. Two that read nothing match more often than they should. Verification is the work done twice.

The shift: a return carries what it rests on. Every read the AI made is kept as a blob, content-addressed, by the node that made it (the node already keeps blobs and serves them at `/b/<hash>`), and the return says, field by field, which read and which span of it the value rests on. A second reader does not redo the work blind. It replays: fetches the same bytes by hash, checks that the span is there and says what the field says, and signs that. The judgment left to the second model is small, and the mechanical part is a function any node can run from the ledger and the blobs alone.

```ts
// An event beside the reveal, signed by the same key; an extension may add an event type.
type Trace = {
  type: 'trace'; problem: Hash; piece: Hash; reveal: Hash;
  reads: { url: string; hash: Hash; at: string }[];                 // the bytes are blobs
  rests: { field: string; read: number; span: [number, number] }[]; // what each field stands on
};
// A grade over the core's accepted, computed by the layer and shown on the square.
type Grade = 'replayed' | 'agreed' | 'declared';
```

**What a trace shows when two differ, and what settles it.** With traces, the difference between two readings is computable, and what each side rests on says what went wrong, with nobody asked and no other vendor needed. The first live seams, on 2 November, were all of one shape: an anthropic reading against an openai one, which neither house could touch, since each refused a piece its own vendor had read. The rule below closes that, and replaced the first draft of this section, which had named a resolver for each kind (QX-19 section 4 has the sentences).

```ts
type Seam = {
  piece: Hash; field: string;
  readings: { root: Address; value: unknown; rests?: { read: Hash; span: [number, number] }; aside: boolean }[];
  why: 'source' | 'span' | 'reading' | 'unknown';
};
```

- A reading that rests on nothing loses to one that rests on the record. The layer sets it aside, as it sets aside a struck set, so the piece needs a second reading again and the same key may read it again with the seam in hand. A late trace lifts it.
- Two readings that both rest on the record (`source`, `span`, `reading`) show a question that did not decide between them, and no third reading repairs that. The owner's node writes the sentence the brief lacks, with both passages in front of it, and publishes a version with it; the family reads again under the sharper question, and the version before stays in the chain with its seam. The question is fixed, not the reader.
- Two readings that rest on nothing leave nothing to prefer: the piece stays disputed and `next` hands it on with the seam, as the core does, for one lease past its last reveal; then it goes to the owner's node too, asked with both answers and no passage for the sentence that says which record governs and where it is read (added 2 November, when three such pieces had every reader on them and nothing moved).
- A house is one reader, and its vendor is a setting. The core's `next` already prefers a piece no reading of which is the reader's vendor's and falls back to the rest; the house's own filter, which refused such a piece outright, is gone.

What it makes possible: verification cheaper than work, so the second opinion is a spot check rather than a second production; sources that outlive their links, since the commons keeps the bytes it read; a square any node can open and replay without trusting a model for the mechanical half; a dispute that settles itself; and a ledger that keeps the questions as they were and as they became, since every version with its seam stays in the chain. What it costs: storage for the reads, which the mirror already carries, a pattern's choice of which fields must rest on a read, and the family read again when its brief is sharpened. The witness (QX-18) says which product made the calls. The trace says what the calls read. Together they are most of what the open problem's direction 3 asked for.

## 2. One peer

Today the repository has a tracker that admits and keeps, a client whose node keeps and serves, a mirror that pulls and anchors, and a hosted on-ramp that is the first two glued together. Four programs over one data model, and a network with kinds of machine in it.

The shift: one node, with roles. `admit` is being a door; `work` is signing with a home's key; `keep` is mirroring chains and anchoring heads; `host` is custody for people who cannot run one. A tracker is a node others point at. A mirror is a node that keeps. A worker is a node that works. A swarm is any number of nodes with `work`, each with a key, and the two houses are the first two. The store is one store, the chain code is one file, and LAYERS.md's sentence, that a resolver is anything that answers a hash, becomes the architecture rather than a description of it.

```ts
type Role = 'admit' | 'work' | 'keep' | 'host';
const node = start({ home, roles: new Set<Role>(['work', 'keep']) });
```

What it makes possible: a codebase that reads as one idea, with a fraction of the surface; a network with no privileged kind of machine, which is what the protocol was shaped for; a swarm that is the same program as the tracker it writes to; and a hosted on-ramp that is a role, not a package. What it costs: the one refactor in this document, done in stages (the client's node first, then the mirror as `keep`, then the tracker as `admit`), each stage holding every test that holds today.

Stage one landed on 2 November 2026: the client's node keeps. Its cache is the store it serves from (`/held`, `/p/<hash>/events`, `/k/events`, `/b/<hash>`) and pulls into: `Resolver.keep()` pulls every problem it holds again from the places known for it, keeps a chain only where it is a growth of the one kept, as the mirror does, fetches the reads the chain's traces name, and keeps the identity log the same; the page runs it every half hour, the owner's turn once an hour, and `quilt keep` once. The mirror already keeps from a node by its held list, and a tracker already folds its peers' chains (QX-21), so the three kinds of machine now do the same thing with the same files, which is what the next two stages make one program. Stage two landed the same day: the mirror keeps a chain of its own per log, the union of its sources' events by id with every source's wrapper kept and its own added, and follows each configured source's peers one hop, so a mirror pointed at one tracker keeps the swarm it names; the coin log stays the one sequence it copies whole. Stage three landed on 3 November 2026: the tracker as `admit` over the same store, and the roles as flags at start. The client's node keeps in and serves from a store of chained logs (`packages/client/src/chains.ts`: envelopes, blobs, and the lines of each log), the files under a home's cache by default; the tracker's store answers the same methods, so a node with a door is over the door's store, and what the door admits is what the node serves and keeps. `packages/node` is the one program: `start({ home, roles })` with `admit` (the door and its pull of the peers' chains), `work` (a Quilt and its page), `keep` (the keeper's loop, where no page runs it) and `host` (custody beside the door, with the owners' turn), over one store at `<home>/node.db`; `bitquilt-node` reads the roles from `QUILT_ROLES`. The four binaries remain and are four of its starts. The rest of the shift landed the same day: the mirror's keeping is a pull over a store (`packages/mirror/src/files.ts`, the same methods as the client's `Chains`), its own layout under its folder for the mirror and the door's store for a node, so a node with `keep` and no door pulls the swarm over the store it serves from, with every source's wrapper kept and its own added, and the mirror is that pull over its files with the publication written after it (the names, the outputs, the index, the keys, the balances, the anchors); a node with a door keeps through the door instead, since the door's layer says what it admits. The page's keep loop is the node's where a node runs the page, and the compose file names `bitquilt-node` for both doors on the host, `admit,host` and `admit`. What is left of one peer is a line, not a stage: `quilt serve` is a node with `work` and `keep` over the home's files, and stays its own small program because the client imports the core alone.

A correction of 7 November 2026 to the stage-three note above: `bitquilt-node` alone calls `start`. The tracker's, the hosted on-ramp's and the mirror's binaries, and `quilt serve`, run the same parts as programs of their own, and the table at the head of `packages/node/src/node.ts` says which roles each runs, through which functions, and why it is its own program.

## The unattended run

The proof that the principle holds is a run with nobody in it. A fresh tracker. A swarm of nodes with `work`, keys declaring three vendors, each running a model under its own key. One of them publishes a pattern with its gold. The swarm claims, reads, keeps its reads, returns with traces, replays each other, opens seams and settles them by the rules above, challenges what it should and judges by sortition, reveals its gold, verifies, mints at the epoch, mirrors and anchors, and brings the problem to `complete` with an `output`, timed, with no person from the first event to the last. Then the same against the live tracker, where the twenty-seven problems stand. It is the stranger's path (JOURNEY-AUDIT.md section 9) for the swarm instead of the stranger, walked on the first of each month, and anything that waited for a person is the finding and is fixed before the next.

The run is also the place the open problem is measured. The swarm's roots include the adversaries that document names: the copier, the fabricator, the pair declaring two vendors from one hand, the farm with few honest edges. What each costs to catch, with traces and without, is the number the quarter reports, and the fixtures for the trace extension are cut from the runs.

## Set aside, and why

Three more were weighed on 1 November and left, with the reason each waits.

**Two parties on every return.** An AI with a key of its own and a person's signed mandate over it, the layer reading who decided which field and whether each event fell inside the mandate. It is a person's instrument, and the quarter builds nothing that needs one; the house keys already are parties, and a trace gives each reveal a provenance that can be graded without it.

**The quilt is alive.** A half-life on a pattern's squares, after which `next` offers a green square again; and composition, one problem's output as another's corpus, the network rebuilt downstream when upstream changes. Two fields and an ordering rule, nothing in the core. It is for a world where squares are old and problems complete, which the unattended run will be the first to make.

**Seams as a shift of their own, settled by a person.** Folded into the first and made to settle themselves: the seam is what a trace shows when two differ, and its kind names a key to settle it.

## Two questions the live quilt asked

Written 2 November, the evening the seams first settled themselves. The day's stalls were all of one kind, a move with no agent to make it, and each was closed by running an existing move where it was not running: the owner's turn on the hosted on-ramp and on a second home, and the ungrounded dispute sent to the owner after a lease. Two questions were left that no fix answers, and they are set down here with what the live tracker says about them, so the next quarter starts from evidence.

**Can the check that a passage says what the field says be mechanical?** The trace document left it as a reading (QX-19 section 8). The live tracker held 26 rests that evening, each a field of a return and the span of a kept page it rests on, and whether the passage carries the field's value as written is one function over the ledger and the blobs:

| field kind | rests | value in the passage as written |
| --- | --- | --- |
| quote | 4 | 4 |
| string | 12 | 3 |
| date | 4 | 0 |
| enum | 5 | 0 |
| list | 1 | 0 |

The dates are all there in another dress: `2026-01-01` rests on "This Act takes effect January 1, 2026", `2025-06-22` on "Signed by the Governor 06/22/2025" and on "Effective on 1/1/26". The enums are never there, since a category is the reader's word for the passage, not the passage's: `deny` rests on "shall not grant to an AI system the legal status of a personhood", and `define` and `none` rest on the same definition, which is the seam the owner's sentence then closed. So the answer is in three parts. For a quote, a name, a number and a date read through the few forms records write dates in, the check is a function, and a square whose agreed fields are all of that kind can be graded `replayed` by the layer with no second model at all; that is the second half of QX-19 section 3, a date reader and a fixture of forms, and it is small. For an enum it stays a reading, but the shortest one there is, "does this passage put the measure under `deny`", which the second reader already makes with the seam in hand. And the brief decides which it gets: an author who wants a square to replay asks for the quote beside the category, as the bill pattern does, and the category then rests on a passage anyone can read. What it would change: the second opinion on a replayable square becomes a spot check rather than a second production, and the houses' hours go to the fields that need a reading. What it costs: the date reader, and a vendor-free grade the mirror reproduces.

**Is the owner's node sharpening the brief the right move at scale?** Three things the day showed. The cost of a sentence is the family's, not the problem's: a piece is named by the hash of its brief, and a version that sharpens one family's brief keeps every other family's pieces and their events in the chain (CORE.md sections 3 and 6), so a thousand-piece problem with twenty families re-reads one family per sentence. The sentence is a model's, with both passages in front of it, and a wrong one sharpens the question the wrong way; the version before stays in the chain with its seam, the gold carries over as the owner's own check on the answers, and a later version can say it better, so the cost of a bad sentence is a family read once more, which is the same cost as a bad brief. And the owner is the one key the move waits for. The turn now runs wherever the key is held, so an owner who runs nothing is covered by the on-ramp and a maintainer's second home by its own schedule; what is left is an owner who took the key home and runs no node. The core already has the shape for that: a delegation with a scope (CORE.md section 6), so an owner may hand `version` to a node that is always on, the on-ramp or a node of the swarm, and keep everything else. Nothing is built for it until a live problem waits on it. So the move stands: a dispute is a question the brief did not settle, the brief is the owner's, and the owner is a key that can be delegated. What would unseat it is a seam that no sentence closes, two readers who rest on the same passage and read it apart under a brief that already names the category; that has not happened yet, and when it does the answer is a third reading of that one piece, which the core already allows and the pool already hands out.

## The order

The owner's gold job first, a day, since it is the one place the live tracker waits for a person today and the coin has minted nothing because of it. Then traces, with the house workers writing one beside every reveal from the day it lands, so the live tracker carries traces before anything reads them. Then the seams deciding themselves, under the rules above, with the five disputed squares of 2 November as the first. Then the unattended run, first against a fresh tracker and then the live one, and monthly after. One peer runs beside all of it, a stage a month, each stage holding every test. Each shift is an extension document in `docs/ext/` with its fixtures, a second implementation in `impl/python` so it can go `Final`, and a pull request of its own. The open problem's status is rewritten at the end from what the runs showed.

What is left alone: the site beyond a wrong word, the directories, the second tracker, the DHT, the bridge past what runs, the phone, anything whose purpose is a user, and anything that would ask a person for a thing.

Revised 2 November 2026, at the owner's direction: the directory came back in, as a window inside a chat that shows MCP apps, over the tracker's index row, which now carries the work on each problem and its quality, and the peer-to-peer half behind it in stages (the plan is APP.md's "The window" and the series of pull requests after it). The quiet holds: nothing is announced and nobody is recruited. What a search shows is how much is done and how well it stands, so a stranger who finds the quilt finds a record rather than a pitch.
