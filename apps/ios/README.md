# Quilt for the iPhone

The iPhone app around a hosted address. It signs nothing and runs no AI. The person's own Claude does the work through the connector at their address ([docs/ext/QX-18.md](../../docs/ext/QX-18.md)), and this app is the part a phone is good for: the problems a tracker carries, each with its map, the one step that puts the address into Claude, and the sentences to say, each handed to Claude with a tap.

## What it does

- **Problems.** Every problem the tracker carries, searched by every word, each with how many of its pieces are settled. A problem opens on its owner's statement of when it is done, quoted as theirs, and its map; a square under a finger says its state and links its page.
- **You.** Until Quilt is in the person's Claude, the page shows the steps left, and each is marked done by what the phone and the tracker say, never by what was tapped. Claude's app is on this phone where it answers the scheme `claude`, asked again each time the app comes to the front; where it is not, the step links the App Store and the later steps open Claude in Safari. An address is made at the tracker's join with one button, or one the person already holds is pasted. Quilt is in Claude once the sheet at the address says an AI has connected, which the tracker records the first time one does; after Claude's own Add custom connector window is opened with the address filled in, the app asks the tracker every few seconds and moves on by itself. From then on the page shows the person's standing, when their Claude last connected, and the sentences the sheet gives.
- **A hand-off.** A button that sends Claude to work shows the sentence first, copies it, and opens a new chat in Claude with the sentence written in. Until an AI has connected, a problem's buttons lead to the steps left instead, since the sentence would reach a Claude that cannot act on it. The sentence is one of the person's own phrases with a link filled in, never anyone else's words (AGENTS.md rule 6).

The address is its own credential, so the app keeps it in the keychain and nowhere else.

## What it reads

All of it is the tracker's own HTTP, which [docs/PROTOCOL.md](../../docs/PROTOCOL.md) lists: `POST /join`, the sheet as JSON beside an address, `/search`, and a problem's `/state`. The tracker is `https://tracker.bitquilt.org/`; a run in the simulator names another with the launch argument `-tracker`, an address with `-address`, and whether Claude's app is there with `-claude yes` or `-claude no`.

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
