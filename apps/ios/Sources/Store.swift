// What the app holds: the person's root key, the address their Claude signs through, kept in the keychain since the
// address is its own credential, their sheet as the tracker last gave it, whether Claude's app is on this phone, the
// tab in front, the sentence on its way to Claude, and what came back: their Claude's work as the record holds it,
// asked again every few seconds while the app is in front, with what changed since the phone last looked.
import Foundation
import Observation
import Security
import UIKit

@MainActor
@Observable
final class Store {
    /// `-address <address>` at launch names one for a run in the simulator, as `-tracker` names a tracker.
    private(set) var address: String? = UserDefaults.standard.string(forKey: "address") ?? Keychain.read()
    private(set) var sheet: Sheet?
    private(set) var problem: String?
    /// The person's root key, made on this phone and kept in its keychain (Root.swift).
    private(set) var root: Root? = RootStore.read()
    /// Whether Claude's app is on this phone, asked again each time the app comes to the front.
    private(set) var claudeInstalled = Claude.installed
    /// The person's own page first while they hold no address here, since it is where one is made; after that, what
    /// their Claude did. `-tab you` at launch names the tab for a run in the simulator.
    var tab = UserDefaults.standard.string(forKey: "tab") ?? (Keychain.read() == nil ? "you" : "activity")
    var handOff: HandOff?

    /// The work of the key the person's Claude signs with, as the tracker last answered it (Work.swift).
    private(set) var work: Work?
    /// What changed last, shown as a banner until it is tapped or a few seconds pass.
    var news: News?
    /// The readings that changed since the Activity page was last looked at.
    private(set) var fresh = Set(UserDefaults.standard.stringArray(forKey: "fresh") ?? [])
    /// What waits on this phone's root: the problems the person's Claude drafted, each published once the root signs
    /// it (Draft.swift).
    private(set) var waiting: [Waiting] = []
    /// What the person asked of their Claude from this app and the address still keeps (Asks.swift).
    private(set) var asks: [Ask] = []
    /// The trigger of the person's own scheduled task in Claude, where they gave this app one (Asks.swift).
    private(set) var wake: Wake? = WakeStore.read()
    /// When this app last started the person's Claude, and the session Claude said it started.
    private(set) var woke: Date?
    private(set) var run: URL?
    /// Counts each change of the work, so a map on screen knows to read its problem again.
    private(set) var pulse = 0
    /// When a sentence last went to Claude: for a few minutes after, the tracker is asked more often.
    private var expecting: Date?

    /// The pieces the person's Claude has read or holds, which a map marks as theirs.
    var mine: Set<String> { Set((work?.readings ?? []).map(\.piece) + (work?.working ?? []).map(\.piece)) }
    /// The pieces their Claude holds now.
    var holding: Set<String> { Set((work?.working ?? []).map(\.piece)) }
    /// What the Activity tab's badge counts: what waits on the person, and, while the page is not in front, what
    /// changed since it was.
    var unseen: Int { waiting.count + (tab == "activity" ? 0 : fresh.count) }

    /// Whether an AI has connected at this address: the tracker records the first time one does, so the sheet says
    /// whether Quilt is in the person's Claude.
    var connected: Bool { sheet?.connected ?? false }

    /// Whether the key behind the address signs for this phone's root, as the tracker counts it: the sheet names the
    /// root the address's key counts for.
    var phoneHoldsRoot: Bool {
        guard let mine = root?.key?.address, let counted = sheet?.standing?.root else { return false }
        return mine == counted
    }

    /// Makes the root here where there is none, makes an address at the tracker, and says at once, as the root, that
    /// the address's key signs for it: the key has signed nothing yet, which a delegation asks.
    func join() async {
        await attempt {
            let key = try self.signing()
            let joined = try await Tracker.join()
            self.keep(joined.url)
            try await Identity.delegate(key, to: joined.address)
        }
        await refresh()
    }

    /// Puts an address whose key the tracker holds as a root under this phone's key. A root that has signed nothing
    /// takes it by a rotation, and everything the address did becomes this phone's. A root that has signed can only
    /// delegate, which stands where the address has signed nothing, as after a join whose delegation did not arrive.
    func bringHome() async {
        guard let address, let key = sheet?.address else { return }
        await attempt {
            let rotates = !(self.root?.signed ?? false) || self.root?.took == key
            let mine = try self.signing(taking: rotates ? key : nil)
            if rotates {
                try await Identity.rotate(at: address, from: key, to: mine)
            } else {
                try await Identity.delegate(mine, to: key)
            }
        }
        await refresh()
    }

    /// Ends the tracker's key: from the revoke's receipt it signs for this phone's root no longer. The address is taken
    /// off this phone, since nothing signed through it would count. Work already accepted stays the root's.
    func revoke() async {
        guard let key = sheet?.address else { return }
        var ended = false
        await attempt {
            try await Identity.revoke(try self.signing(), of: key)
            ended = true
        }
        if ended { forget() }
    }

    /// The root's key for an act that signs, made and kept where there is none, and marked as having signed before it
    /// does, with the address a rotation takes, so a post whose answer was lost is not taken for one never made.
    private func signing(taking: String? = nil) throws -> SigningKey {
        var held = try root ?? RootStore.make()
        guard let key = held.key else { throw WireError(errorDescription: "The key in this phone's keychain is not one.") }
        if !held.signed || (taking != nil && held.took != taking) {
            held.signed = true
            if let taking { held.took = taking }
            RootStore.write(held)
        }
        root = held
        return key
    }

    /// Keeps an address the person already holds, once the tracker answers its sheet.
    func use(_ pasted: String) async {
        let trimmed = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^https?://\S+/mcp/[0-9a-f]{64}$"#, options: .regularExpression) != nil else {
            problem = "An address ends in /mcp/ and sixty-four letters and digits."
            return
        }
        await attempt {
            self.sheet = try await Tracker.sheet(at: trimmed)
            self.keep(trimmed)
        }
    }

    /// Looks again: whether Claude's app is on this phone, and the sheet, which says whether an AI has connected, the
    /// standing and the sentences.
    func refresh() async {
        claudeInstalled = Claude.installed
        guard let address else { return }
        await attempt { self.sheet = try await Tracker.sheet(at: address) }
    }

    /// Asks the tracker every few seconds until an AI has connected, so the page moves on by itself once Quilt is in
    /// Claude. A read that fails is tried again and says nothing.
    func awaitConnection() async {
        while let address, !connected, !Task.isCancelled {
            if let sheet = try? await Tracker.sheet(at: address) { self.sheet = sheet }
            if connected { break }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    /// A sentence is on its way to Claude, or the person is back, so the work is asked for every few seconds for a while.
    func expect() { expecting = Date() }

    /// Asks the tracker for the work while the app is in front: every three seconds for five minutes after the app
    /// came to the front or a sentence went to Claude, and while Claude holds a piece; every five while an answer
    /// is on the record with no square yet, since another reading may come; every twenty otherwise. The task that
    /// runs it ends it.
    func watch() async {
        expect()
        while !Task.isCancelled {
            await look()
            let lately = expecting.map { Date().timeIntervalSince($0) < 300 } ?? false
            let waiting = (work?.readings ?? []).contains { $0.standing == .onRecord } || asks.contains { $0.handed == nil }
            try? await Task.sleep(for: .seconds(lately || !holding.isEmpty ? 3 : waiting ? 5 : 20))
        }
    }

    /// One look: what waits on this phone's root, then the work. What changed since the last look is said as news,
    /// a draft that waits before anything else, and a reading that changed is marked fresh until the Activity page is
    /// looked at. The first look on a phone marks everything seen and says nothing. A read that fails is tried again
    /// at the next look and says nothing.
    func look() async {
        guard let address else { return }
        if sheet == nil, let read = try? await Tracker.sheet(at: address) { sheet = read }
        let asked = await lookForDrafts(at: address)
        await lookForAsks(at: address)
        guard let key = sheet?.address, let now = try? await Tracker.work(of: key), now != work else { return }
        let defaults = UserDefaults.standard
        let seen = defaults.dictionary(forKey: "seen") as? [String: String]
        let held = Set(defaults.stringArray(forKey: "held") ?? [])
        let stands = Dictionary(now.readings.map { ($0.key, String(describing: $0.standing)) }) { a, _ in a }
        defaults.set(stands, forKey: "seen")
        defaults.set((now.working ?? []).map(\.piece), forKey: "held")
        work = now
        pulse += 1
        guard let seen else { return }
        fresh.formUnion(stands.filter { seen[$0.key] != $0.value }.keys)
        defaults.set(Array(fresh), forKey: "fresh")
        guard !asked, let first = now.news(since: seen, held: held).first else { return }
        say(first)
        // An agreement moves the standing, which the sheet carries.
        if first.kind == .agreed, let read = try? await Tracker.sheet(at: address) { sheet = read }
    }

    /// Reads what waits on this phone's root, and says a draft it has not said before. Whether it said one.
    private func lookForDrafts(at address: String) async -> Bool {
        guard let mine = root?.key?.address, let listed = try? await Tracker.waiting(at: address) else { return false }
        let now = listed.filter { $0.root == mine }
        guard now != waiting else { return false }
        waiting = now
        let said = Set(UserDefaults.standard.stringArray(forKey: "asked") ?? [])
        UserDefaults.standard.set(now.map(\.id), forKey: "asked")
        guard let draft = now.first(where: { !said.contains($0.id) }) else { return false }
        let title = (try? Draft(draft, root: mine))?.title
        say(News(kind: .asked, title: "Your Claude drafted a problem",
                 body: (title.map { "\($0). " } ?? "") + "It waits for your key. Read it, and publish it if it is right.", state: "open"))
        return true
    }

    /// Reads the asks the address keeps, and says so when the person's Claude has picked one up since the last look.
    private func lookForAsks(at address: String) async {
        guard let listed = try? await Tracker.asks(at: address), listed != asks else { return }
        let waited = Set(asks.filter { $0.handed == nil }.map(\.id))
        asks = listed
        guard let picked = listed.first(where: { $0.handed != nil && waited.contains($0.id) }) else { return }
        say(News(kind: .sent, title: "Your Claude has what you asked", body: "\(picked.title). It is working from it now, and what it does shows up here.", state: "in_flight"))
    }

    /// Leaves a hand-off at the address as an ask, and where `waking` and a trigger is kept, starts the person's
    /// Claude. Whether the ask was kept. A start that fails leaves the ask waiting, and the banner says why.
    func ask(_ handOff: HandOff, waking: Bool) async -> Bool {
        guard let address, let phrase = handOff.phrase else { return false }
        var kept = false
        await attempt {
            let made = try await Tracker.ask(phrase, problem: handOff.problem, at: address)
            self.asks.removeAll { $0.id == made.id }
            self.asks.append(made)
            kept = true
        }
        guard kept else { return false }
        expect()
        guard waking, let wake else {
            say(News(kind: .sent, title: "Left for your Claude", body: "\(handOff.title). It waits at your address. In your Claude chat, press its button on Quilt\u{2019}s card, or say \u{201C}Do what I asked on Quilt\u{201D}.", state: "open"))
            return true
        }
        do {
            let fired = try await wake.fire()
            woke = Date()
            run = fired.url.flatMap { URL(string: $0) }
            say(News(kind: .sent, title: "Your Claude is starting", body: "\(handOff.title). It reads what you asked and does it, and its answer shows up here.", state: "in_flight"))
        } catch {
            say(News(kind: .sent, title: "Asked, and Claude did not start", body: "\(error.localizedDescription) What you asked still waits at your address.", state: "disputed"))
        }
        return true
    }

    /// Takes an ask back before the person's Claude has read it.
    func takeBack(_ ask: Ask) async {
        guard let address else { return }
        await attempt {
            try await Tracker.takeBack(ask, at: address)
            self.asks.removeAll { $0.id == ask.id }
        }
    }

    /// Keeps the trigger of the person's scheduled task in this phone's keychain. Whether the two are a Fire URL and
    /// a token as Claude gives them.
    func keepWake(url: String, token: String) -> Bool {
        guard let made = Wake(url: url, token: token) else { return false }
        WakeStore.write(made)
        wake = made
        return true
    }

    /// Forgets the trigger: a tap opens Claude with a sentence again.
    func forgetWake() {
        WakeStore.delete()
        wake = nil
        woke = nil
        run = nil
    }

    /// Starts the person's task once with nothing asked, to see that Claude takes the trigger. What happened, in a
    /// sentence.
    func tryWake() async -> String {
        guard let wake else { return "No trigger is kept on this phone." }
        do {
            let fired = try await wake.fire()
            woke = Date()
            run = fired.url.flatMap { URL(string: $0) }
            return "Claude took it and started the task. With nothing asked, the task reads that and stops."
        } catch {
            return error.localizedDescription
        }
    }

    /// Publishes a draft: the person is asked for, the root signs the envelope and its version, and the address
    /// posts them. Whether it was published.
    func publish(_ draft: Draft) async -> Bool {
        guard let address, await Presence.confirm("Publish \u{201C}\(draft.title)\u{201D} with your key.") else { return false }
        var done = false
        await attempt {
            try await Tracker.answer(draft.waiting, at: address, with: draft.answer(signedBy: try self.signing()))
            done = true
        }
        guard done else { return false }
        waiting.removeAll { $0.id == draft.waiting.id }
        pulse += 1
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        return true
    }

    /// Drops a draft: nothing is signed, and the address keeps it no longer.
    func decline(_ draft: Waiting) async {
        guard let address else { return }
        await attempt {
            try await Tracker.answer(draft, at: address, with: Data(#"{"decline":true}"#.utf8))
            self.waiting.removeAll { $0.id == draft.id }
        }
    }

    private func say(_ news: News) {
        self.news = news
        UINotificationFeedbackGenerator().notificationOccurred(news.kind == .differs ? .warning : .success)
    }

    /// The Activity page was looked at: nothing on it is fresh any more.
    func sawActivity() {
        fresh = []
        UserDefaults.standard.removeObject(forKey: "fresh")
    }

    /// Takes the address off this phone. The root stays in the keychain, and the address's key stays at the tracker,
    /// reached by the address alone. What this phone had seen of the address's work goes with it.
    func forget() {
        Keychain.delete()
        address = nil
        sheet = nil
        unsee()
    }

    private func unsee() {
        work = nil
        waiting = []
        fresh = []
        for name in ["seen", "held", "fresh", "asked"] { UserDefaults.standard.removeObject(forKey: name) }
    }

    func clearProblem() { problem = nil }

    private func keep(_ url: String) {
        Keychain.write(url)
        address = url
        unsee()
    }

    private func attempt(_ work: () async throws -> Void) async {
        do {
            try await work()
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// The one item this app keeps in the keychain: the person's address.
enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.bitquilt.quilt.address",
    ]

    static func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        delete()
        var q = query
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
