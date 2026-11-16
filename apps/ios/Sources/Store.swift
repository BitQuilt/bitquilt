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
    /// Counts each change of the work, so a map on screen knows to read its problem again.
    private(set) var pulse = 0
    /// When a sentence last went to Claude: for a few minutes after, the tracker is asked more often.
    private var expecting: Date?

    /// The pieces the person's Claude has read or holds, which a map marks as theirs.
    var mine: Set<String> { Set((work?.readings ?? []).map(\.piece) + (work?.working ?? []).map(\.piece)) }
    /// The pieces their Claude holds now.
    var holding: Set<String> { Set((work?.working ?? []).map(\.piece)) }
    /// What the Activity tab's badge counts: nothing while the page is in front.
    var unseen: Int { tab == "activity" ? 0 : fresh.count }

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
    /// waits on a second reading; every twenty otherwise. The task that runs it ends it.
    func watch() async {
        expect()
        while !Task.isCancelled {
            await look()
            let lately = expecting.map { Date().timeIntervalSince($0) < 300 } ?? false
            let waiting = (work?.readings ?? []).contains { $0.standing == .waiting }
            try? await Task.sleep(for: .seconds(lately || !holding.isEmpty ? 3 : waiting ? 5 : 20))
        }
    }

    /// One look at the work. What changed since the last is said as news, the weightiest first, and marked fresh
    /// until the Activity page is looked at. The first look on a phone marks everything seen and says nothing. A read
    /// that fails is tried again at the next look and says nothing.
    func look() async {
        guard let address else { return }
        if sheet == nil, let read = try? await Tracker.sheet(at: address) { sheet = read }
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
        guard let first = now.news(since: seen, held: held).first else { return }
        news = first
        UINotificationFeedbackGenerator().notificationOccurred(first.kind == .differs ? .warning : .success)
        // An agreement moves the standing, which the sheet carries.
        if first.kind == .agreed, let read = try? await Tracker.sheet(at: address) { sheet = read }
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
        fresh = []
        for name in ["seen", "held", "fresh"] { UserDefaults.standard.removeObject(forKey: name) }
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
