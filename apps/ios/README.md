# Quilt for the iPhone

The iPhone app around a hosted address. It signs nothing and runs no AI. The person's own Claude does the work through the connector at their address ([docs/ext/QX-18.md](../../docs/ext/QX-18.md)), and this app is the part a phone is good for: the problems a tracker carries, each with its map, the one step that puts the address into Claude, and the sentences to say, each handed to Claude with a tap.

## What it does

- **Problems.** Every problem the tracker carries, searched by every word, each with how many of its pieces are settled. A problem opens on its owner's statement of when it is done, quoted as theirs, and its map; a square under a finger says its state and links its page.
- **You.** With no address, one button makes one at the tracker's join, and a second takes an address the person already holds. With an address, the page shows the two steps left: Claude's own Add custom connector window opened with the address filled in, and a first sentence. Once an AI has connected, it shows the person's standing and the sentences the sheet at their address gives.
- **A hand-off.** A button that sends Claude to work shows the sentence first, copies it, and opens a new chat in Claude with the sentence written in. The sentence is one of the person's own phrases with a link filled in, never anyone else's words (AGENTS.md rule 6).

The address is its own credential, so the app keeps it in the keychain and nowhere else.

## What it reads

All of it is the tracker's own HTTP, which [docs/PROTOCOL.md](../../docs/PROTOCOL.md) lists: `POST /join`, the sheet as JSON beside an address, `/search`, and a problem's `/state`. The tracker is `https://tracker.bitquilt.org/`; a run in the simulator names another with the launch argument `-tracker`, and an address with `-address`.

## Building

XcodeGen writes the Xcode project and the Info.plist from `project.yml`, and neither is committed.

```bash
cd apps/ios && xcodegen generate
```

```bash
./build-testflight.sh 2 --upload
```

The script archives and exports build 2 and, with `--upload`, sends it to TestFlight; its header says which names it reads from the environment. The faces are the Mac app's, read from `apps/mac/Resources/Fonts`.

## What is not built yet

- A push when a piece the person's Claude returned is settled. It needs a server that holds device tokens.
- The coin. The app shows standing alone.
- Any way to work a piece without the person's own Claude.
