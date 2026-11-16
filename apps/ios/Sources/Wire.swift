// The wire as a phone writes it (docs/v2/WIRE.md; docs/CORE.md sections 1 and 4): canonical JSON, a hash, Keccak-256,
// an address with its checksum, a signature over an object's canonical JSON, and an event with its id. It is written
// from the documents and held to vectors the reference made (Tests/vectors.json), so a phone signs the same bytes a
// Quilt does. The curve is the one thing not written here: secp256k1 comes from the package P256K.
import CryptoKit
import Foundation
import P256K

/// A JSON value of the kinds an event holds. A number is whole: nothing a phone signs carries another.
indirect enum JSON: Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    /// Canonical JSON, RFC 8785: keys sorted by UTF-16 code units, no whitespace, strings as JSON.stringify writes them.
    var canonical: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .int(let n): return String(n)
        case .string(let s): return JSON.quoted(s)
        case .array(let items): return "[" + items.map(\.canonical).joined(separator: ",") + "]"
        case .object(let fields):
            let keys = fields.keys.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
            return "{" + keys.map { JSON.quoted($0) + ":" + fields[$0]!.canonical }.joined(separator: ",") + "}"
        }
    }

    /// The UTF-8 bytes of the canonical form, which is what is hashed and signed.
    var canonicalBytes: [UInt8] { Array(canonical.utf8) }

    /// A string as JSON.stringify writes it: the quote, the backslash and the control characters escaped, the rest as is.
    private static func quoted(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
            }
        }
        return out + "\""
    }

    /// A value read from JSON text, or nothing where the text is not JSON or holds a number that is not whole.
    init?(text: String) {
        guard let any = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed]) else { return nil }
        self.init(any)
    }

    subscript(_ name: String) -> JSON? {
        if case .object(let fields) = self { return fields[name] }
        return nil
    }

    var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    /// A value as Foundation's JSON reader gives one, for the vectors and for what a tracker answers.
    init?(_ any: Any) {
        switch any {
        case is NSNull: self = .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) }
            // A number that is not whole is none this phone writes, so the value is refused and nothing is signed.
            else if n.doubleValue == Double(n.intValue) { self = .int(n.intValue) } else { return nil }
        case let s as String: self = .string(s)
        case let a as [Any]:
            var items: [JSON] = []
            for x in a {
                guard let j = JSON(x) else { return nil }
                items.append(j)
            }
            self = .array(items)
        case let o as [String: Any]:
            var fields: [String: JSON] = [:]
            for (k, v) in o {
                guard let j = JSON(v) else { return nil }
                fields[k] = j
            }
            self = .object(fields)
        default: return nil
        }
    }
}

enum Hex {
    static func string(_ bytes: some Sequence<UInt8>) -> String {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func bytes(_ hex: String) -> [UInt8]? {
        let s = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        guard s.count % 2 == 0 else { return nil }
        var out: [UInt8] = []
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(i, offsetBy: 2)
            guard let b = UInt8(s[i ..< j], radix: 16) else { return nil }
            out.append(b)
            i = j
        }
        return out
    }
}

/// Keccak-256 as Ethereum uses it: the padding of the original Keccak, not SHA-3's.
enum Keccak {
    private static let constants: [UInt64] = [
        0x0000_0000_0000_0001, 0x0000_0000_0000_8082, 0x8000_0000_0000_808A, 0x8000_0000_8000_8000,
        0x0000_0000_0000_808B, 0x0000_0000_8000_0001, 0x8000_0000_8000_8081, 0x8000_0000_0000_8009,
        0x0000_0000_0000_008A, 0x0000_0000_0000_0088, 0x0000_0000_8000_8009, 0x0000_0000_8000_000A,
        0x0000_0000_8000_808B, 0x8000_0000_0000_008B, 0x8000_0000_0000_8089, 0x8000_0000_0000_8003,
        0x8000_0000_0000_8002, 0x8000_0000_0000_0080, 0x0000_0000_0000_800A, 0x8000_0000_8000_000A,
        0x8000_0000_8000_8081, 0x8000_0000_0000_8080, 0x0000_0000_8000_0001, 0x8000_0000_8000_8008,
    ]
    private static let rotations = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44]
    private static let lanes = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1]
    private static let rate = 136

    static func hash256(_ message: [UInt8]) -> [UInt8] {
        var padded = message
        padded.append(0x01)
        while padded.count % rate != 0 { padded.append(0) }
        padded[padded.count - 1] |= 0x80
        var state = [UInt64](repeating: 0, count: 25)
        for block in stride(from: 0, to: padded.count, by: rate) {
            for lane in 0 ..< rate / 8 {
                var word: UInt64 = 0
                for byte in 0 ..< 8 { word |= UInt64(padded[block + lane * 8 + byte]) << UInt64(8 * byte) }
                state[lane] ^= word
            }
            permute(&state)
        }
        var out: [UInt8] = []
        for lane in 0 ..< 4 {
            for byte in 0 ..< 8 { out.append(UInt8(truncatingIfNeeded: state[lane] >> UInt64(8 * byte))) }
        }
        return out
    }

    private static func permute(_ a: inout [UInt64]) {
        for constant in constants {
            var c = [UInt64](repeating: 0, count: 5)
            for x in 0 ..< 5 { c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] }
            for x in 0 ..< 5 {
                let d = c[(x + 4) % 5] ^ rotated(c[(x + 1) % 5], 1)
                for y in stride(from: 0, to: 25, by: 5) { a[y + x] ^= d }
            }
            var carried = a[1]
            for i in 0 ..< 24 {
                let next = a[lanes[i]]
                a[lanes[i]] = rotated(carried, rotations[i])
                carried = next
            }
            for y in stride(from: 0, to: 25, by: 5) {
                let row = Array(a[y ..< y + 5])
                for x in 0 ..< 5 { a[y + x] = row[x] ^ (~row[(x + 1) % 5] & row[(x + 2) % 5]) }
            }
            a[0] ^= constant
        }
    }

    private static func rotated(_ x: UInt64, _ n: Int) -> UInt64 { (x << UInt64(n)) | (x >> UInt64(64 - n)) }
}

struct WireError: LocalizedError {
    let errorDescription: String?
}

/// A secp256k1 key as the core has one: the secret, and the address a client writes as its `key`.
struct SigningKey: Equatable {
    let secret: [UInt8]
    let address: String

    /// A new key from the system's random bytes.
    static func make() throws -> SigningKey {
        for _ in 0 ..< 8 {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { break }
            // A secret outside the curve's order is refused by the curve, and another is drawn.
            if let key = try? SigningKey(secret: bytes) { return key }
        }
        throw WireError(errorDescription: "This phone could not make a key.")
    }

    init(secret: [UInt8]) throws {
        let key = try P256K.Recovery.PrivateKey(dataRepresentation: secret, format: .uncompressed)
        self.secret = secret
        address = Address.of(publicKey: Array(key.publicKey.dataRepresentation))
    }

    /// EIP-191 over these bytes: a recoverable signature as 0x, r, s and v (27 or 28) in hex.
    func sign(_ message: [UInt8]) throws -> String {
        let key = try P256K.Recovery.PrivateKey(dataRepresentation: secret, format: .uncompressed)
        let digest = try HashDigest(Address.personalHash(message))
        let compact = try key.signature(for: digest).compactRepresentation
        guard compact.recoveryId == 0 || compact.recoveryId == 1 else {
            throw WireError(errorDescription: "This phone made a signature the wire does not write.")
        }
        return "0x" + Hex.string(compact.signature) + String(format: "%02x", 27 + compact.recoveryId)
    }
}

enum Address {
    /// The address of an uncompressed public key, sixty-five bytes: the last twenty of the Keccak of the rest.
    static func of(publicKey: [UInt8]) -> String {
        checksum(Hex.string(Keccak.hash256(Array(publicKey.dropFirst())).suffix(20)))
    }

    /// EIP-55: the address in mixed case so that a wrong letter is caught.
    static func checksum(_ hex40: String) -> String {
        let lower = hex40.lowercased()
        let hashed = Array(Hex.string(Keccak.hash256(Array(lower.utf8))))
        var out = "0x"
        for (i, c) in lower.enumerated() {
            let high = (hashed[i].hexDigitValue ?? 0) >= 8
            out.append(c.isLetter && high ? Character(c.uppercased()) : c)
        }
        return out
    }

    /// The EIP-191 personal-message hash: Keccak-256 of the prefix, the byte length and the message.
    static func personalHash(_ message: [UInt8]) -> [UInt8] {
        Keccak.hash256(Array("\u{19}Ethereum Signed Message:\n\(message.count)".utf8) + message)
    }
}

/// An event a phone signs: the line of CORE.md section 4. What a root signs here goes to the identity log and names
/// no problem (`delegate`, `revoke` and a rotation's second signature), but for the `version` of a problem the root
/// publishes, which names it. No event a phone signs names a piece.
struct WireEvent {
    /// The event without `sig` and `sig_to`.
    let unsigned: [String: JSON]
    private(set) var signatures: [String: JSON] = [:]

    init(type: String, key: String, at: Date = Date(), problem: String? = nil, body: [String: JSON]) {
        var fields: [String: JSON] = ["quilt": .int(1), "type": .string(type), "key": .string(key), "ts": .string(WireEvent.time(at)), "body": .object(body)]
        if let problem { fields["problem"] = .string(problem) }
        unsigned = fields
    }

    /// An event read back, as a tracker hands one to be signed a second time.
    init?(_ value: JSON) {
        guard case .object(var fields) = value else { return nil }
        for name in ["sig", "sig_to"] { if let s = fields.removeValue(forKey: name) { signatures[name] = s } }
        unsigned = fields
    }

    /// The id: the hash of the event without its signatures.
    var id: String { "sha256:" + Hex.string(SHA256.hash(data: Data(JSON.object(unsigned).canonicalBytes))) }

    /// Signs the event in `field`, `sig` for the key it names and `sig_to` for the root a rotation names.
    mutating func sign(with key: SigningKey, in field: String = "sig") throws {
        signatures[field] = .string(try key.sign(JSON.object(unsigned).canonicalBytes))
    }

    /// The event with its signatures, as a value.
    var signed: JSON { .object(unsigned.merging(signatures) { $1 }) }

    /// The event as it is posted.
    var posted: Data { Data(signed.canonicalBytes) }

    /// A time as the reference stamps one: to the millisecond, in UTC, with Z.
    static func time(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }
}
