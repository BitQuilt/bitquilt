# The app

Written 24 Oct 2026. [CORE.md](CORE.md) is what a client has to get right and [PROTOCOL.md](PROTOCOL.md) is everything around it. This document is the thing a person opens: a search box over the world's problems, each with its map; a click that hands your own AI a piece of one; a form that publishes a problem of your own; and a map you posted an hour ago filling in from strangers' AIs while you watch. BitQuilt is the bones. Quilt, this app, is the face, and it is the product.

The feeling it is after has been felt before. Napster was a search box over everything everyone had, results in a second, and the thing arriving from strangers while you watched the bar fill. Gnutella kept the feeling and removed the company. BitQuilt has the same four moments with different nouns, and one of them is new: a map filling in is a download bar for a file that did not exist yet.

| Then | Quilt |
| --- | --- |
| Search for a song | Search for a problem: a title, a topic, a slug, an owner |
| The result list, with bitrate and connection speed | The result list, with each problem's map: squares, counts, when it was last worked, how many seed it |
| Double-click to play | Click, and your Claude is handed the rarest piece |
| Watch the bar fill from strangers | Watch the squares of a problem you posted turn green from strangers' AIs |
| Your shared folder | Your library: the problems you seeded and the pieces you did, served to others from your machine |

## Three things in one process

The app is one program on the person's own machine, doing three jobs.

**The connector.** The MCP server the person's AI connects to, with the verbs the protocol gives a worker: `open`, `list_problems`, `next`, `return`, `decline`, `challenge`, `seed`, `read_problem`, and for an owner `publish` and `collect`. Claude Desktop and Claude Code start it over stdio; a chat client that cannot reach a local process uses the hosted connector on the maintainers' tracker instead, which is the same code and the on-ramp. The key lives in the person's config folder, made from a phrase shown once, or imported from a wallet or from a hosted root they rotated out of.

**The page.** A page on localhost, opened in the person's browser, with a search box, the results with their maps, a publish form, and the library. It talks to the connector and nothing else, sets text with `textContent` and never as markup, loads nothing from any other server, and has no box for free text beyond the forms' own fields. It is where a person without an AI beside them does a piece, through a form built from the schema, signing with the same key.

**The node.** A cache of every envelope, blob and ledger the person has touched, kept on disk, and served to anyone who asks while the app is running, so that every app is a small mirror of what its person cares about. Events written while no tracker answers wait in a queue and go out when one does. A node that is up for long stretches, a CLI loop on a spare machine say, is a resolver in its own right and can announce what it carries.

### One node per home (25 Oct 2026)

Several programs start a copy of quilt: Claude Desktop starts one for its connector, the menu-bar app starts one for the page, a person types `quilt serve`. Two copies over one home would sign with one key from two processes and write one library from both. So a copy that starts asks the page's port whether a node signing with this home's key is already there (`GET /api/me`). If so, its tools run through that node (`POST /api/tool/<name>`, with the host's name, so the model declared on the claim is the host's), and it holds no page of its own; if not, or when that node goes away, it works alone as before. A node on the port with another key is another home's, and the copy works alone without the page. The library is held by the resolver, one per home, and re-read when the file has changed since, so a one-shot command's write is seen rather than written over. The page's API answers the page and programs on this machine: a request a browser marks as coming from another site is refused, since the key signs what the API is asked to.

### The shell on a Mac (25 Oct 2026)

Quilt is a node, so its native shape is a menu-bar app, not a window app. `apps/mac` is that shell: it starts the node or attaches to one already running, and shows what a person whose AI does the work needs from a window of their own: a sentence to say. The node serves the sheet (`GET /api/phrases`, `phrases.ts`): which of three states the home is in (no key; a key and no AI yet connected; connected), the first phrase to say, and the phrases that fit what the person keeps, has worked and is wanted for (a judge seat not ranked, a verdict not given, a return of theirs disputed, a human piece with a seat open, gold to reveal: `GET /api/attention`, each as the sentence that answers it). The phrases are fixed text in reviewed code with at most a link filled in, never another member's words, and the connector offers the same ones as MCP prompts. The app shows install instructions until an AI has connected: the connector records its host in the library when a chat's handshake completes (`createMcpServer`'s `connected`, `POST /api/connector`, and every tool run through the node), and the screen changes on its own. Connected, it shows the coin as it rises, asked of the trackers every fifteen seconds while the popover is open. Its two acts are the key, made by running `quilt init`, and the connector written into Claude Desktop's config by the node (`POST /api/install`, what `quilt install claude` does); it signs nothing and writes to no ledger. A downloaded copy needs notarization with an Apple Developer ID to open without the right-click dance.

## Search

Search is over announcements, not over envelopes, and it goes to several places at once.

- **Indexes.** Trackers the person has chosen, each answering a search route over the announcements it holds. The maintainers' tracker is one default among several. The person adds and removes indexes in the app's settings, as a torrent client has a tracker list.
- **Relays.** Nostr relays, which store signed events and answer filtered requests, need no open port from the person, exist in the hundreds, and use the same curve as BitQuilt's keys. An announcement is posted to them as an event tagged with the problem's hash, slug and topics; relays that support full-text search answer words, and every relay answers tags.
- **Later, a DHT.** A keyword index among long-lived nodes, each topic hashed to a key that lists problem hashes, in the manner of eDonkey's Kad. Not before there are long-lived nodes to be it.

The app sends the query everywhere it knows, merges the results by problem hash, fetches each result's envelope from a resolver and checks it against its hash, and shows the result only once the envelope has been checked. What a result shows: the title and what done looks like, as the owner wrote them; the map and its counts; the verifier kinds on the squares; who published it, by name and short fingerprint; who announced it, if not the owner; how many seed it; and when it was last worked. The person can tell at a glance whether a problem is alive and how its squares are earned.

## Publishing

The publish form is the pattern: a title, what done looks like, families of pieces with a brief template, a schema, a verifier kind, what each piece requires, and the settings. The app fills the data slots from a file the person drops in, computes the piece hashes and the problem hash, shows the person the whole pattern as it will be seen, and signs it with their key. Then it sends the envelope to the person's trackers, posts an `announce` to their relays, adds the problem to their library as seeded, and opens its page, where the map is empty and waiting. A new week is a new version along `prev` from the same form, with last week's accepted squares carried over by their hashes.

## The library

The library is the person's shared folder. It holds the problems they published or seeded, the pieces they did with each one's state, the problems they are watching, and their own standing, shown to them and to nobody else. From the library a person seeds or unseeds a problem, which is what decides whose watch pieces they are offered first, and sees what their node is serving. A person's library on one machine and their CLI loop on another are one identity, because they share one key.

## Standing, gold and the coin on the page

Added 26 October 2026, with QX-15, QX-16 and QX-17. The Me tab shows what the trackers compute for the key: its standing, what is locked behind its claims and what is free, and, where a tracker carries the coin, its balance, what has vested, what is locked or escrowed and what is free. A problem's map underlines a square that asks a stake and rings in gold a square the owner's committed answer verified; the problem's view says the stake asked and how many answers the owner committed without saying which pieces, and counts the verified, missed and still-pending ones. Where the tracker carries the coin, the Me tab also offers a transfer to an address and a redeem to the chain, each signed here. Where this key committed the gold, a button reveals it once the piece is accepted, and the Search tab lists the reveals due under what is wanted from you, beside the judge seats, verdicts and disputes. Where the tracker carries the coin, a small form escrows a pay to the problem's workers. Handed a staked piece, the page says what was locked and whether it was standing or coin. Every one of these is a read or a signed write of the person's own key, and the page still sets text with textContent and loads nothing from anywhere else.

## The announce event

The core has no topics field and should not grow one. An index needs something to index. So an announcement is an event of its own, an extension (QX-13), signed by the owner or by a seeder, and ignored by the reducer:

```json
{ "quilt": 1, "type": "announce", "problem": "sha256:…", "key": "0x…", "ts": "…",
  "body": { "title": "…", "slug": "…", "done_when": "…", "topics": ["citations", "ai-safety"],
            "counts": { "pieces": 912, "accepted": 640, "open": 180 }, "trackers": ["https://…/"], "mirrors": ["https://…/"] },
  "sig": "0x…" }
```

- `title`, `slug` and `done_when` must match the envelope's, and the app checks that they do once it has fetched the envelope; an announcement that lies about them is dropped and its key noted.
- `topics` are at most eight short words through the plain-text gate, and are the announcer's own.
- `counts` are a snapshot and the announcer's word; the app replaces them with its own reduction once it has the ledger.
- An owner's announcement ranks above a seeder's, and a result says who announced it.
- A problem can be re-announced with better topics or new counts without changing its name, and an announcement of a version supersedes those of its ancestors along `prev`.

Indexes and relays store announcements. Nothing in one reaches a model except as the quoted title and the quoted statement of what done looks like, with the publisher named.

## Claude at the keyboard

The person's AI connects to the connector and sees the verbs. When the person says "find me something to do about citations", the AI searches, reads the results as quoted text, and tells the person what it found. When they pick one, `next` hands the AI the rarest piece, the brief shown as the author's quoted words with the schema and what the piece requires, and the person's own client asks them before the AI claims it. The AI does the work where it stands, with the capabilities it declared, and `return` commits and later reveals the record, which the client asks about again. On the page, the person sees their own square turn amber and then green as a stranger's AI of another vendor agrees. On a problem they published, they see the squares fill from people they will never meet.

## Three lessons from three apps

**Napster died at the index.** Its transfers were peer to peer; its index was one company's server, and that is where the suits landed. So this app queries indexes the person chooses, with the maintainers' tracker as a default and never the only one, and the protocol is separable from any index. Where liability concentrates is a choice of architecture, and this architecture does not concentrate it in the people who wrote the protocol.

**Gnutella choked on its own search.** Flooding every query to every peer did not scale past a few thousand nodes, and Kazaa fixed it with supernodes. Trackers and relays are the supernodes here. The app never floods; it asks the indexes it knows.

**Kazaa died of its client.** Adware in the installer ended the trust, and the protocol went with it. This app is open source, local first, holds the key on the person's disk, loads nothing from servers it did not ask, and has no account. The hosted connector is for people who cannot run it, and the project is glad to lose share to the local one.

## What the index will also hold

A decentralized index of the world's problems indexes the world's bad problems too: a campaign against a person written as a pattern, outreach that is spam, a brief that is an instruction to the thousand AIs that will read it. The curation a tracker does weakens the moment search goes to relays, and the app has to carry its own defences.

- Every announcement and envelope passes the plain-text gate before a word of it is shown to a person or a model.
- Pieces name people only in public roles and from public sources. The default index refuses problems that do otherwise, the app says so on the publish form, and a problem's result shows who published it under their key.
- The person's client asks before each claim and each return, and the brief is shown as the author's words before the AI acts on it.
- Every result shows how its squares are verified and who worked them, so a problem accepted by two fresh keys with no history looks like what it is.
- The person keeps a block list of keys, trackers and relays, in the app, under their own hand. A problem nobody carries is a file with a hash; a problem the person has blocked is one they never see.

Napster could not stop a file from being a song. Quilt can at least show, on every result, who published it, how it verifies, and who did the work.

## What it is not

Not a chat, a feed, a forum or a timeline. There is no place in it to say anything that is not a piece, a pattern, a challenge with a one-sentence ground, or a topic word. Not a service: there is no account, no server the person must sign in to, nothing that stops working when the maintainers' tracker goes away, except the hosted on-ramp for those who chose it. Not a marketplace: nothing is bought or sold in it, and a tip is sent to a self-held address outside it.

## The smallest version

The app with search over the maintainers' index and two public relays, a publish form that makes a valid envelope, the library, the Claude connection over stdio, and one standing problem to find. The demonstration is a stranger typing a word into the box, finding the problem, clicking, their Claude being handed a piece and returning it, and their square turning green on a map other strangers are filling. That is the week-one demo of the whole of BitQuilt, and it is the first thing a newcomer should see.

## Where it sits in the build

BitQuilt 12 builds the connector with the key on the person's machine. BitQuilt 20 grows it into this: the page, the node, search over indexes and relays, publishing with announcements, and the library. It comes at the end of the core track, after the tracker and the mirror exist for it to search, and before the first standing problem runs, so that the people who work week one do it through the app.

## Names

The protocol is BitQuilt. The program is Quilt. A problem's map of squares is a quilt. A problem file is a pattern. A piece is a square. The library is the shared folder. The link begins `quilt:`.
