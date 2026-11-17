# Quilt for the iPhone

The iPhone app around a hosted address. It runs no AI: the person's own Claude does the work through the connector at their address ([docs/ext/QX-18.md](../../docs/ext/QX-18.md)). It holds the person's root key and signs what only a root signs. The key the tracker holds for the address is the root's delegate, so the work is the phone's key's and the tracker's key can be ended from the phone ([docs/PROTOCOL.md](../../docs/PROTOCOL.md), Identity: roots and delegates). Beside that, the app is the part a phone is good for: the problems a tracker carries, each with its map, the one step that puts the address into Claude, the sentences to say, each handed to Claude with a tap, and what came back, shown as it happens.

## What it does

- **Problems.** Every problem the tracker carries, searched by every word, each with how many of its pieces are settled. A problem opens on its owner's statement of when it is done, quoted as theirs, and its map; a square under a finger says its state and links its page.
- **You.** Until Quilt is in the person's Claude, the page shows the steps left, and each is marked done by what the phone and the tracker say, never by what was tapped. Claude's app is on this phone where it answers the scheme `claude`, asked again each time the app comes to the front; where it is not, the step links the App Store and the later steps open Claude in Safari. An address is made at the tracker's join with one button, or one the person already holds is pasted. Quilt is in Claude once the sheet at the address says an AI has connected, which the tracker records the first time one does; after Claude's own Add custom connector window is opened with the address filled in, the app asks the tracker every few seconds and moves on by itself. From then on the page shows the person's standing, when their Claude last connected, and the sentences the sheet gives.
- **Activity.** What the person's Claude did, as the record holds it. The app cannot read Claude's chat, and no app can. It does not need to: everything Claude does on Quilt is a signed line on a problem's log, so the app asks the tracker for the work of the key Claude signs with (`/k/<address>/work`) and shows it. The page has the piece Claude holds now, a square for each answer it handed back, and each answer with its fields, the passage it rests on, the readings beside it and where it stands: on the record under the person's key, read the same by another AI, or read differently with both kept. An answer is whole once it is signed, and the page says so: no answer is shown as waiting. The tracker is asked every three seconds for five minutes after the app comes to the front or a sentence goes to Claude and while Claude holds a piece, every five while an answer is on the record with no square yet, and every twenty otherwise, and only while the app is in front. What changed since the last look is said in a banner over whatever page is in front, with a tap of the phone's haptics, and marked on the tab until the page is looked at. A problem's map marks the squares that are the person's Claude's and reads itself again as the work changes. A reading's sheet ends in the sentence that sends Claude back for another piece.
- **Asks.** A connector answers Claude's calls and starts none, so this app cannot hand Claude a sentence through it. It leaves the request where Claude reads it: a tap on "Leave it for my Claude" posts an ask to the address (`/mcp/<token>/asks`), a phrase's name and a problem's hash and no other words, and Claude lists the asks with `quilt_asked` when it next takes a turn (docs/APP.md, What a person asks from their own app). Activity shows each ask as waiting, where it can be taken back, or as picked up. The turn comes from the person in the Claude chat they already have, by a press on the ask's button on Quilt's card there or by saying "Do what I asked on Quilt", or from the app itself: under You, "Let Quilt start your Claude" takes the Fire URL and the token of a scheduled task the person made in Claude, with the prompt the page gives, and from then a tap on "Ask my Claude" leaves the ask and fires the task, which runs on the person's plan with their connectors, while "Leave it for my Claude" stays beside it for the chat the person keeps. The URL is taken only where it is a task's fire at Anthropic's API, the token is kept in this phone's keychain and sent there alone, and the fire carries no text (`Sources/Asks.swift`). Not yet tried against Claude's own endpoint from a phone: the request is written as Claude's documentation gives it, and held so by `Tests/AsksTests.swift`.
- **Waiting for you.** A problem is published by a root (CORE.md section 4), and the key the tracker holds for the address is the phone's root's delegate, so a problem the person's Claude drafts is not published. The address keeps the draft and lists it at `/mcp/<token>/waiting` as the text the root signs. Activity shows it above everything else, with a banner when it arrives and a mark on the tab while it waits. `Sources/Draft.swift` reads the title, the statement of done and each kind of piece out of that text and nothing else, and signs only where the text is canonical as the phone writes it, the owner is this phone's root, and the hash is the one the draft was listed under; a draft that holds a number that is not whole is refused. "Publish with my key" asks for the person with Face ID, Touch ID or the passcode, signs the envelope and the `version` of the problem, and the address posts them. "Not this one" drops the draft and signs nothing.
- **A hand-off.** A button that sends Claude to work shows the sentence first, copies it, and opens a new chat in Claude with the sentence written in. Until an AI has connected, a problem's buttons lead to the steps left instead, since the sentence would reach a Claude that cannot act on it. The sentence is one of the person's own phrases with a link filled in, never anyone else's words (AGENTS.md rule 6).

- **The key.** `Sources/Root.swift`. At "Make my key and address" the phone makes a secp256k1 key, keeps it in the keychain, joins, and posts a `delegate` from that key to the new address's key before that key has signed anything. An address the person already held is brought under a root that has signed nothing by a `rotate`, which the phone writes and signs as the new root and the on-ramp signs as the old. "End the tracker's key" posts the root's `revoke`. After each, the phone asks the tracker which root the address's key counts for, and the page says where the key is from that answer. A delegation runs ten years, since one cannot be made again to a key that has signed, and the revoke is what ends it.

The root is kept in the keychain, and in iCloud Keychain where the person has that on, so a lost phone does not lose it. The address is its own credential for the tracker's key, so the app keeps it in the keychain too and nowhere else.

## What it signs with

`Sources/Wire.swift` is the wire written for a phone from [docs/v2/WIRE.md](../../docs/v2/WIRE.md) and [docs/CORE.md](../../docs/CORE.md) sections 1 and 4: canonical JSON, Keccak-256, an address with its checksum, a signature over an object's canonical JSON, and an event with its id. The curve comes from one package, `swift-secp256k1`, pinned in `project.yml`, since Apple's own libraries do not carry secp256k1. `Tests/WireTests.swift` holds it to `Tests/vectors.json`, which the core writes:

```bash
node node_modules/tsx/dist/cli.mjs apps/ios/Tests/vectors.ts > apps/ios/Tests/vectors.json
```

`Tests/WireTests.swift` also holds a draft: read from the text it signs, signed as the reference signs it, and refused where it is not what it says. `Tests/WorkTests.swift` holds the reading of a key's work, each standing's sentence and what the phone says changed between two looks. `Tests/DoorTests.swift` and `Tests/StoreTests.swift` put the root to a real door: a delegation the tracker counts, a rotation, a revoke, the store's join, and a problem drafted through the address and published by the phone's key. They are skipped unless an on-ramp that holds a problem is named, and the store's run in the simulator alone, since they write the keychain:

```bash
TEST_RUNNER_QUILT_TEST_TRACKER=http://localhost:3977/ xcodebuild test -project Quilt.xcodeproj -scheme Quilt -destination 'platform=iOS Simulator,name=iPhone 16 Pro'
```

## What it reads

All of it is the tracker's own HTTP, which [docs/PROTOCOL.md](../../docs/PROTOCOL.md) lists: `POST /join`, the sheet as JSON beside an address, `/search`, a problem's `/state`, a key's `/k/<address>/standing` and `/k/<address>/work`, the identity log at `/k/events`, and the address's `/rotate` and `/waiting`. The tracker is `https://tracker.bitquilt.org/`; a run in the simulator names another with the launch argument `-tracker`, an address with `-address`, the tab in front with `-tab you`, whether Claude's app is there with `-claude yes` or `-claude no`, the newest reading's sheet opened with `-reading first` or the newest draft's with `-reading draft`, and the question for the person left out with `-presence no`.

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

- A push when a piece the person's Claude returned is settled. It needs a server that holds device tokens, so the app says what changed only while it is in front.
- The coin. The app shows standing alone.
- Any way to work a piece without the person's own Claude.
- A draft's rows shown before it is signed. The phone signs the hash of each data blob, which the envelope names, and shows the briefs with their slots unfilled.
- A stake rule or a gold posted from the phone, and the owner's hourly turn for a problem the phone's root owns: sharpening a brief and taking a proposed piece each ask the root's signature, and nothing asks the phone for it yet.
- The root shown as twelve words, or carried to a Quilt on another machine.
