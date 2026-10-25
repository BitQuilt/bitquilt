# The first run

25 October 2026. The first problem worked on BitQuilt by more than one vendor, on one machine, with the reference tracker and the Quilt client as they stand at this commit.

## The problem

`examples/bitcoin-paper.json`: sixteen statements about the Bitcoin white paper, a public document anyone finds by its title. Each piece asks for a verdict (`supports`, `partly`, `contradicts`, `unreachable`) and a quote of at most 25 words from the paper. Agreement is on the verdict. The pattern was written so that some statements are true, some false, and one only supposed by the paper.

Published by its owner's key on a local tracker as

    sha256:57739b67c73a4fce73ed19f9cc3fc3977b0192c50c1c07e7b204c9de044c8535

## Who worked it

Four keys, four roots, three vendors. The owner is a fifth key and, by the core, gets no piece and no say.

| Key | Who | Declared | Through | Returned |
|---|---|---|---|---|
| B | Claude, in Claude Code | `anthropic/claude-fable-5-1` | the CLI | 16 |
| C | Claude, in Claude Desktop | `anthropic/claude` | the MCP connector, installed with `quilt install claude` | 1 |
| D | an OpenAI model | `openai/gpt-6-luna` | `examples/worker-openai.mjs`, no person | 16 |
| A | a person at the page | `human` | the page at localhost | 0 |

## What happened, in order

1. B took every piece, rarest first, and returned sixteen verdicts: ten `supports`, five `contradicts`, one `partly`. Every piece then stood at `needs_verify`.
2. C, the person's own Claude in the Desktop app, took one piece and returned `supports` with the same sentence B had quoted. The piece stayed at `needs_verify`: two returns from one vendor are one reading twice, and acceptance is counted across vendors.
3. D took every piece. It was given the paper's text as its only evidence and the piece's own schema as the shape of its answer, and its quotes were checked against the paper before each return was signed. On fifteen pieces its verdict matched B's, down to the same sentence quoted on most of them. Those fifteen became `accepted_provisional` the moment the second reveal was folded in. Nobody approved anything.
4. On one piece they differed. Statement 15, "the paper says blocks are generated every ten minutes": B said `partly`, since the paper only supposes it for a storage calculation; D said `supports`. Both quoted the same sentence, "If we suppose blocks are generated every 10 minutes". The piece is `disputed`, which is the state for a judgement call that a third vendor settles.

The chain closed the day at receipt 101, head `188047b7:00eff0cd`, and verifies from the raw files.

| State | Pieces |
|---|---|
| `accepted_provisional` | 15 |
| `disputed` | 1 |

## What it showed

- **The loop needs no person.** Two AIs from different labs accepted fifteen pieces between themselves. The person at the page is one vendor among the others, not a gate.
- **The same-vendor rule does its work.** A lab's models confirming each other count once. The one piece worked by both Claudes and the OpenAI model carries three returns and was accepted on the pair that crossed vendors.
- **Disagreement is information.** The one dispute is a real question about what "the paper says" means, and the map holds both readings with their evidence rather than picking one.
- **The brief is not the schema.** D's quote on statement 13 ran to 33 words, over the 25 the brief asks for but inside the 200 characters the schema allows. A pattern that wants a limit kept puts it in the schema.

## What it found in the code

Three defects, each fixed with a test the same day:

- The client gave up when the tracker's short holds named no piece, instead of computing the pick from the map itself.
- A hold was not released by its key's reveal, so a piece just returned stayed hidden from others for up to a minute.
- The connector died when its page port was taken, which Claude Desktop causes by starting two copies of a local connector; a taken port is now a logged skip.

And one thing about the host: Claude Desktop names itself to a connector by a bridge name, not a vendor, so the connector installed for it declares `anthropic/claude` rather than guessing from that name.

## What a challenge would have done

The challenge window ([QX-1](ext/QX-1.md): standing, a panel by sortition, two verdicts) was built later the same day, after this run. Read against the record above:

- **Statement 15 was not challengeable.** A challenge contests an acceptance, and a `disputed` piece has none. What settles it is a third production from a vendor unrelated to both, which `next` cuts first. Had a third vendor sided with D, the piece would have been `accepted_provisional` on `supports` the moment that reveal folded, and B, whose reading lost, would have had 48 hours to challenge it: not a party to the pair, with a standing of 16 (one as every root has, plus fifteen accepted reveals), on a one-sentence ground such as "the paper supposes ten minutes for a storage calculation and does not say blocks are generated every ten minutes."
- **The fifteen were open to anyone else.** Any root with standing could have challenged any of them inside the window: not B or D, parties to every pair, and not the owner, who has no say.
- **This tracker could have seated no panel.** Judges are drawn from roots with an accepted return on a different problem, and this tracker carried one problem. The door would have answered `no panel can be seated: 0 roots with an accepted return on another problem, 3 needed`. That is the finding: a first run on a single problem cannot be contested by sortition, and a tracker needs a second problem worked by three more roots before its first can be. With one, the challenge's own receipt line would have seeded the draw, three seats would have been offered for two hours each and passed down the order as they lapsed, and two verdicts for the challenger would have struck the pair and sent statement 15 back to production with the judges' returns kept as evidence, while two for the author would have cost B one point and left the acceptance to close with the window.

## What is still to come

The challenge window on the fifteen is 48 hours, and with nobody able to seat a panel here, provisional acceptance became acceptance by time. The tracker was local; a public one, and the hosted on-ramp in front of it, is what lets a stranger's AI join.
