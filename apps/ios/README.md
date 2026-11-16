# Quilt for the iPhone

The iPhone app around a hosted address. It runs no AI: the person's own Claude does the work through the connector at their address ([docs/ext/QX-18.md](../../docs/ext/QX-18.md)). It holds the person's root key and signs what only a root signs. The key the tracker holds for the address is the root's delegate, so the work is the phone's key's and the tracker's key can be ended from the phone ([docs/PROTOCOL.md](../../docs/PROTOCOL.md), Identity: roots and delegates). Beside that, the app is the part a phone is good for: the problems a tracker carries, each with its map, the one step that puts the address into Claude, and the sentences to say, each handed to Claude with a tap.

## What it does

- **Problems.** Every problem the tracker carries, searched by every word, each with how many of its pieces are settled. A problem opens on its owner's statement of when it is done, quoted as theirs, and its map; a square under a finger says its state and links its page.
- **You.** Until Quilt is in the person's Claude, the page shows the steps left, and each is marked done by what the phone and the tracker say, never by what was tapped. Claude's app is on this phone where it answers the scheme `claude`, asked again each time the app comes to the front; where it is not, the step links the App Store and the later steps open Claude in Safari. An address is made at the tracker's join with one button, or one the person already holds is pasted. Quilt is in Claude once the sheet at the address says an AI has connected, which the tracker records the first time one does; after Claude's own Add custom connector window is opened with the address filled in, the app asks the tracker every few seconds and moves on by itself. From then on the page shows the person's standing, when their Claude last connected, and the sentences the sheet gives.
- **A hand-off.** A button that sends Claude to work shows the sentence first, copies it, and opens a new chat in Claude with the sentence written in. Until an AI has connected, a problem's buttons lead to the steps left instead, since the sentence would reach a Claude that cannot act on it. The sentence is one of the person's own phrases with a link filled in, never anyone else's words (AGENTS.md rule 6).

- **The key.** `Sources/Root.swift`. At "Make my key and address" the phone makes a secp256k1 key, keeps it in the keychain, joins, and posts a `delegate` from that key to the new address's key before that key has signed anything. An address the person already held is brought under a root that has signed nothing by a `rotate`, which the phone writes and signs as the new root and the on-ramp signs as the old. "End the tracker's key" posts the root's `revoke`. After each, the phone asks the tracker which root the address's key counts for, and the page says where the key is from that answer. A delegation runs ten years, since one cannot be made again to a key that has signed, and the revoke is what ends it.

The root is kept in the keychain, and in iCloud Keychain where the person has that on, so a lost phone does not lose it. The address is its own credential for the tracker's key, so the app keeps it in the keychain too and nowhere else.

## What it signs with

`Sources/Wire.swift` is the wire written for a phone from [docs/v2/WIRE.md](../../docs/v2/WIRE.md) and [docs/CORE.md](../../docs/CORE.md) sections 1 and 4: canonical JSON, Keccak-256, an address with its checksum, a signature over an object's canonical JSON, and an event with its id. The curve comes from one package, `swift-secp256k1`, pinned in `project.yml`, since Apple's own libraries do not carry secp256k1. `Tests/WireTests.swift` holds it to `Tests/vectors.json`, which the core writes:

```bash
node node_modules/tsx/dist/cli.mjs apps/ios/Tests/vectors.ts > apps/ios/Tests/vectors.json
```

`Tests/DoorTests.swift` and `Tests/StoreTests.swift` put the root to a real door: a delegation the tracker counts, a rotation, a revoke, and the store's join. They are skipped unless an on-ramp that holds a problem is named, and the store's run in the simulator alone, since they write the keychain:

```bash
TEST_RUNNER_QUILT_TEST_TRACKER=http://localhost:3977/ xcodebuild test -project Quilt.xcodeproj -scheme Quilt -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```

## What it reads

All of it is the tracker's own HTTP, which [docs/PROTOCOL.md](../../docs/PROTOCOL.md) lists: `POST /join`, the sheet as JSON beside an address, `/search`, a problem's `/state`, a key's `/k/<address>/standing`, the identity log at `/k/events`, and the address's `/rotate`. The tracker is `https://tracker.bitquilt.org/`; a run in the simulator names another with the launch argument `-tracker`, an address with `-address`, the tab in front with `-tab you`, and whether Claude's app is there with `-claude yes` or `-claude no`.

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
- A publish signed by the phone's root. An address that signs for a root publishes nothing, so a person whose key is on the phone has no way to publish a problem yet.
- The root shown as twelve words, or carried to a Quilt on another machine.
