# The documents

Each kind of reader has a path through the documents, in order, with what each one answers. The documents state what is true of the code now; the dated records of how it got here are under [history/](history/README.md). Everything here is CC0.

## A person trying Quilt

1. [README.md](../README.md#getting-started), "Getting started": where to get Quilt, and the first sentence to say to your AI.
2. [bitquilt.org/how.html](https://bitquilt.org/how.html): what accepted means, kind by kind, how a person holds their own key, and the problem left open.
3. [APP.md](APP.md): what Quilt is: the connector, the page, the window in a chat, the Mac app, and the run while you are away.
4. [LAYERS.md](LAYERS.md): the whole protocol in plain words, for what lies under the app.

## Someone writing a client

1. [LAYERS.md](LAYERS.md): what a client has to get right, and what it may leave aside and still compute the same map.
2. [CORE.md](CORE.md), sections 1 to 8 and 11: the forms (canonical JSON, hashes, keys and signatures), the envelope, the piece hash, the event line, the receipt wrapper, the reducer, `next`, the link a client resolves and checks, and the gate a return passes at the door. The fixtures hold sections 6 and 7 (section 9), so a client computes the map and the pick itself; a tracker's `GET /p/<hash>/state` is that tracker's view, a convenience.
3. [PROTOCOL.md](PROTOCOL.md#the-tracker), "The tracker": the routes a client calls.
4. [EXTENSIONS.md](EXTENSIONS.md): the registry, for the extension behind a verifier kind or a refusal the client meets; each number links its document.
5. [impl/python](../impl/python/README.md): the core written a second time from CORE.md and the fixtures alone, the reference for the forms in another language, and [its findings](../impl/python/FINDINGS.md), where the two readings of the document parted.
6. [The fixtures](../packages/core/fixtures/README.md): a client is a client when it reproduces every one: the states, the count of dropped events, `complete`, the output hash and the picks.

## A contributor to the code

1. [AGENTS.md](../AGENTS.md): the layout, the names, where the words live, and what a change keeps true, with the test behind each rule.
2. [LAYERS.md](LAYERS.md): the layers the packages are cut along.
3. [CORE.md](CORE.md): the frozen core, and why `packages/core` changes only in a version-2 conversation.
4. [EXTENSIONS.md](EXTENSIONS.md), then the document under [ext/](ext/) for the area: what an extension may do, and exactly what this one does. The code cites their section numbers.
5. [NODE.md](NODE.md): how the programs run: the roles, the one store, the keeper and the mirror job.
6. [examples/README.md](../examples/README.md): a tracker, a problem and a worker on one machine.

## An auditor of the protocol

1. [CORE.md](CORE.md), with its section 12 and [the fixtures](../packages/core/fixtures/README.md): what a client is held to, and every clarified sentence pinned to a fixture.
2. [impl/python/FINDINGS.md](../impl/python/FINDINGS.md): where an implementation written from the document alone read it apart from the reference.
3. [PROTOCOL.md](PROTOCOL.md): why each part is as it is, what the record guarantees and what it does not, and where it is weak.
4. [OPEN-PROBLEM.md](OPEN-PROBLEM.md): costless acceptance, the gap version 1 does not close, with what has been tried.
5. [EXTENSIONS.md](EXTENSIONS.md) and [ext/](ext/): every rule above the core. [QX-11](ext/QX-11.md) and [QX-12](ext/QX-12.md) say what a chain and its anchor prove, and what they do not.
6. [COIN.md](COIN.md): what the coin is for, what was given up to have it, and its trust, said plainly.

## A maintainer who runs a tracker

1. [DEPLOY.md](DEPLOY.md): every variable, the public door, the second peer, the houses, the bridge, the order a public tracker comes up in, and the walk before strangers.
2. [deploy/README.md](../deploy/README.md): the host's own commands.
3. [NODE.md](NODE.md): the programs and roles the compose file runs, what each reads, and [the mirror job](NODE.md#6-the-mirror-job).
4. [.env.example](../.env.example): every name the executables read, and which reads it.
5. [QX-11](ext/QX-11.md), section 7: the contracts and the jobs of the bridge.
6. [apps/mac/README.md](../apps/mac/README.md): building, signing and notarizing the Mac app.

## Every document

- [LAYERS.md](LAYERS.md): the whole protocol in plain words, layer by layer, with the numbers left to the registry.
- [CORE.md](CORE.md): the BitQuilt core, version 1. What a client has to get right, and nothing else.
- [CLIENT.md](CLIENT.md): writing a client. The forms with one claim worked byte for byte, a first return in six steps, the second reading that makes a square, what the state and the log say after, the door's checks in the order it runs them, and what a worker may leave aside. Read it with CORE.md sections 1, 2, 4 and 11, and QX-19 sections 1 and 2.
- [PROTOCOL.md](PROTOCOL.md): why each rule is as it is, and everything around the core: the tracker and its routes, the mirror, identity, governance, lineage, weaknesses. Its plan and reviews of 24 October 2026 are in [history/2026-10-24-protocol-review.md](history/2026-10-24-protocol-review.md).
- [EXTENSIONS.md](EXTENSIONS.md): how everything outside the core changes, and the registry, each number with its layer and its document.
- [ext/](ext/): one document per extension, once it is first implemented, saying exactly what is built; the three verifier kinds (`judge:n`, `human`, `attest`) share [one](ext/verifiers.md).
- [APP.md](APP.md): Quilt, the thing a person opens.
- [NODE.md](NODE.md): one node with roles over one store, the keeper's pull, the mirror job, and the programs.
- [COIN.md](COIN.md): what the coin is for and what was given up to have it.
- [OPEN-PROBLEM.md](OPEN-PROBLEM.md): costless acceptance, stated as a problem, with its dated notes of what has been tried.
- [DEPLOY.md](DEPLOY.md): running a public tracker with the hosted on-ramp.
- [WORKSHOP.md](WORKSHOP.md): the plan for the three months from 1 November 2026, with nothing announced, under one principle: nothing in the protocol waits for a person. It stays here until the quarter ends on 31 January 2027.
- [candidates/](candidates/): the problems surveyed, the fifty chosen for launch, and the two waves of twelve written as patterns.
- [history/](history/README.md): the dated records: the protocol's plan and reviews, the first run, the coin's plan, the launch steps, the readability audit, the coin's audit and the journey audit, each with where its live facts went.

The argument these grew from, and the first host, live in the Workshop repository, which is the maintainers' and not public: its `docs/SWARM.md` and `docs/DESIGN.md`. The documents here name those two files in words rather than links.
