// What waits on this phone's root (docs/PROTOCOL.md, Identity: roots and delegates). The key the tracker holds for
// the address signs the person's Claude's work, and a problem is published by a root (CORE.md section 4), so a problem
// their Claude drafts is kept at the address until the root signs it. The tracker hands the draft as the very text the
// root signs. This file reads the draft out of that text and nothing else, so what the page shows the person is what
// the key signs: the phone writes the text again in canonical form and signs only where the two are the same, the
// owner is this phone's root, and the hash is the one the draft was listed under.
import CryptoKit
import Foundation
import LocalAuthentication

/// One publish that waits, as the address lists it at /mcp/<token>/waiting.
struct Waiting: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let at: String
    let expires: String
    let root: String
    /// The envelope without its `sig`, as canonical JSON: the text the root signs.
    let envelope: String
    let topics: [String]
    let left: [String]
}

/// A draft read from the text the root signs.
struct Draft {
    /// A family of pieces, or one piece: its name, how many, the kind of check that accepts it, and its brief.
    struct Family: Identifiable, Hashable {
        let name: String
        let count: Int
        let verifier: String
        let brief: String

        var id: String { name }

        /// The name without the mark of a family, `/*`.
        var plain: String { name.hasSuffix("/*") ? String(name.dropLast(2)) : name }

        /// The check in plain words.
        var check: String {
            if verifier == "agree" { return "Every answer is kept. Two AIs from different companies that agree make the square." }
            if verifier.hasPrefix("record:") { return "Every reading is kept, and none is picked." }
            if verifier.hasPrefix("judge:") { return "A panel ranks the candidates." }
            if verifier == "human" { return "A person answers." }
            if verifier == "attest" { return "The one who does it says so." }
            if verifier == "check" || verifier == "score" { return "A script checks the work." }
            return "Checked by \(verifier)."
        }
    }

    let waiting: Waiting
    let title: String
    let doneWhen: String
    let slug: String
    let families: [Family]
    /// Whether the draft is the next version of a problem the root already published.
    let replaces: Bool

    var pieces: Int { families.reduce(0) { $0 + $1.count } }
    var hash: String { waiting.id }

    /// Reads a draft for the root given, or says why this phone will not sign it.
    init(_ waiting: Waiting, root: String) throws {
        guard waiting.kind == "publish" else { throw WireError(errorDescription: "This phone does not know what a \(waiting.kind) asks it to sign.") }
        guard let envelope = JSON(text: waiting.envelope), envelope.canonical == waiting.envelope else {
            throw WireError(errorDescription: "This draft is not written as the wire writes one, so this phone will not sign it.")
        }
        guard case .object(let outer) = envelope, Set(outer.keys) == ["quilt", "problem", "hints"], outer["quilt"] == .int(1),
              let problem = outer["problem"], case .object(let pieces)? = problem["pieces"],
              let title = problem["title"]?.string, let doneWhen = problem["done_when"]?.string, let slug = problem["slug"]?.string
        else { throw WireError(errorDescription: "This draft is not a problem's envelope, so this phone will not sign it.") }
        guard problem["owner"]?.string == root, waiting.root == root else {
            throw WireError(errorDescription: "This draft names another key as its owner, so this phone's key does not sign it.")
        }
        // CORE.md section 2: a problem's name is the hash of its `problem` alone.
        guard "sha256:" + Hex.string(SHA256.hash(data: Data(problem.canonicalBytes))) == waiting.id else {
            throw WireError(errorDescription: "This draft is not the one it was listed as, so this phone will not sign it.")
        }
        self.waiting = waiting
        self.title = title
        self.doneWhen = doneWhen
        self.slug = slug
        replaces = problem["prev"].map { $0 != .null } ?? false
        families = pieces.keys.sorted().map { name in
            let piece = pieces[name]!
            var count = 1
            if case .int(let n)? = piece["count"] { count = n }
            return Family(name: name, count: count, verifier: piece["verifier"]?.string ?? "", brief: piece["brief"]?.string ?? "")
        }
    }

    /// The root's answer, as the address takes it: its signature over the envelope's text, and the `version` of the
    /// problem it signs, "Signed by a root" (CORE.md section 4), with the body `{ slug, hash }`.
    func answer(signedBy key: SigningKey, at: Date = Date()) throws -> Data {
        guard key.address == waiting.root else { throw WireError(errorDescription: "This draft waits on another key.") }
        var version = WireEvent(type: "version", key: key.address, at: at, problem: hash, body: ["slug": .string(slug), "hash": .string(hash)])
        try version.sign(with: key)
        let sig = try key.sign(Array(waiting.envelope.utf8))
        return Data(JSON.object(["sig": .string(sig), "version": version.signed]).canonicalBytes)
    }
}

/// The person at the phone, asked for before the root signs what goes out under their name: Face ID, Touch ID or the
/// phone's passcode. A phone with none of them set has nothing to ask with, and the tap stands. `-presence no` at
/// launch leaves the question out, for a run in the simulator, where nobody is there to answer it.
enum Presence {
    static func confirm(_ reason: String) async -> Bool {
        if UserDefaults.standard.string(forKey: "presence") == "no" { return true }
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return true }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}
