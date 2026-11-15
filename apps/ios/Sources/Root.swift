// The person's root key, made and kept on this phone, and the three events it signs (docs/PROTOCOL.md, Identity: roots
// and delegates; docs/CORE.md section 4). The tracker's on-ramp makes a second key for the person's Claude to sign
// with. A `delegate` from the root says that key signs for it, a `revoke` ends that, and a `rotate` hands an address
// that was its own root over to this one. The tracker answers which root a key counts for, and each act is confirmed
// by that answer and not by the post having been taken.
import Foundation
import Security

/// The root as the keychain keeps it: the secret, whether it has signed, since a rotation takes only a key that has
/// not (CORE.md section 4: "`to` has no prior event"), and the address it signed a rotation from, so that rotation can
/// be sent again where its answer was lost.
struct Root: Codable, Equatable {
    let secret: String
    var signed: Bool
    var took: String?

    var key: SigningKey? { Hex.bytes(secret).flatMap { try? SigningKey(secret: $0) } }
}

/// The root's place in the keychain. It is kept in iCloud Keychain where the person has that on, so a lost phone does
/// not lose the key.
enum RootStore {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.bitquilt.quilt.root",
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]

    static func read() -> Root? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Root.self, from: data)
    }

    @discardableResult static func write(_ root: Root) -> Bool {
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecAttrSynchronizable as String] = true
        q[kSecValueData as String] = (try? JSONEncoder().encode(root)) ?? Data()
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    /// Takes the root out of the keychain. Nothing in the app calls it: a root is the person's to keep. The tests of
    /// the store call it, in the simulator alone.
    static func delete() {
        SecItemDelete(query as CFDictionary)
    }

    /// A new root, kept before it is used. A key that could not be kept is not used: its work could not be claimed.
    static func make() throws -> Root {
        let root = Root(secret: Hex.string(try SigningKey.make().secret), signed: false)
        guard write(root) else { throw WireError(errorDescription: "This phone could not keep a new key in its keychain.") }
        return root
    }
}

enum Identity {
    /// What the tracker's key may sign for the root: the events of working a piece and of judging one. What only a
    /// root signs, and what an owner or the coin signs, is left out.
    static let scope = ["claim", "commit", "reveal", "decline", "run", "name", "seed", "trace", "propose", "lock", "challenge", "verdict", "rank"]

    /// A delegation cannot be renewed to the same key (CORE.md section 4: "`to` has no prior event"), and a new key is
    /// a new address to put into Claude. So it runs ten years, and the root's `revoke` is what ends it.
    static let years = 10

    /// "`to` may sign events of the types in `scope` for the root until `expires`." Kept only while `to` has signed
    /// nothing, so it is posted at once after the join that made `to`.
    static func delegate(_ root: SigningKey, to address: String, at: Date = Date()) async throws {
        let expires = Calendar(identifier: .gregorian).date(byAdding: .year, value: years, to: at) ?? at
        var event = WireEvent(type: "delegate", key: root.address, at: at, body: [
            "to": .string(address),
            "scope": .array(scope.map(JSON.string)),
            "expires": .string(WireEvent.time(expires)),
        ])
        try event.sign(with: root)
        try await Tracker.post(identity: event)
        try await confirm(address, countsFor: root.address)
    }

    /// "From this event's receipt, `of` signs for it no longer." The door's taking it is the answer here: a key that
    /// was rotated to this root counts for it after the revoke as before, since what it did stays the root's.
    static func revoke(_ root: SigningKey, of address: String, at: Date = Date()) async throws {
        var event = WireEvent(type: "revoke", key: root.address, at: at, body: ["of": .string(address)])
        try event.sign(with: root)
        try await Tracker.post(identity: event)
    }

    /// An address that was its own root, handed to this phone's: "Everything the old root did is the new root's; the
    /// old root is a delegate of the new until revoked." The phone writes the event and signs it as the new root in
    /// `sig_to`; the on-ramp, which holds the old root's key, signs it in `sig` and posts it.
    static func rotate(at url: String, from address: String, to root: SigningKey, at: Date = Date()) async throws {
        var event = WireEvent(type: "rotate", key: address, at: at, body: ["to": .string(root.address)])
        try event.sign(with: root, in: "sig_to")
        try await Tracker.rotate(at: url, event: event)
        try await confirm(address, countsFor: root.address)
    }

    /// The door takes an identity event it will not count, and the fold drops it. So the tracker is asked which root
    /// the key counts for. It answers as of the moment it last read its logs, which a burst of posts can run ahead
    /// of, so it is asked a few times before its answer is taken for a no.
    private static func confirm(_ address: String, countsFor root: String) async throws {
        for attempt in 0 ..< 4 {
            if attempt > 0 { try await Task.sleep(for: .milliseconds(700)) }
            if try await Tracker.standing(of: address).root == root { return }
        }
        throw TrackerError(errorDescription: "The tracker took the event and does not count it. A key that has signed before cannot be taken in this way.")
    }
}
