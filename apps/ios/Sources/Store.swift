// What the app holds: the person's address, kept in the keychain since the address is its own credential, their
// sheet as the tracker last gave it, and the sentence on its way to Claude.
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
    var handOff: HandOff?

    var connected: Bool { sheet?.connected ?? false }

    /// Makes an address at the tracker and keeps it.
    func join() async {
        await attempt {
            let joined = try await Tracker.join()
            self.keep(joined.url)
        }
        await refresh()
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

    /// Reads the sheet again: whether an AI has connected, the standing and the sentences.
    func refresh() async {
        guard let address else { return }
        await attempt { self.sheet = try await Tracker.sheet(at: address) }
    }

    /// Takes the address off this phone. The key stays at the tracker, reached by the address alone.
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
