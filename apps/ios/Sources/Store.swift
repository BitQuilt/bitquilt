// What the app holds: the person's root key, the address their Claude signs through, kept in the keychain since the
// address is its own credential, their sheet as the tracker last gave it, whether Claude's app is on this phone, the
// tab in front, and the sentence on its way to Claude.
import Foundation
import Observation
import Security

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
    /// The person's own page first while they hold no address here, since it is where one is made. `-tab you` at
    /// launch names the tab for a run in the simulator.
    var tab = UserDefaults.standard.string(forKey: "tab") ?? (Keychain.read() == nil ? "you" : "problems")
    var handOff: HandOff?

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

    /// Takes the address off this phone. The root stays in the keychain, and the address's key stays at the tracker,
    /// reached by the address alone.
    func forget() {
        Keychain.delete()
        address = nil
        sheet = nil
    }

    func clearProblem() { problem = nil }

    private func keep(_ url: String) {
        Keychain.write(url)
        address = url
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
