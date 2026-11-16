// What the person's Claude did, as the record holds it: the tracker's answer at /k/<address>/work for the key their
// Claude signs with (docs/PROTOCOL.md, Routes), and the plain words this app says of it. The app cannot read Claude's
// chat, and does not need to: everything Claude does on Quilt is a signed line on a problem's log, so the way back
// from Claude to this phone is the record itself.
import Foundation

/// A value of a return as the tracker hands it, shown as text and never read as anything else.
enum Loose: Decodable, Hashable {
    case text(String)
    case whole(Int)
    case number(Double)
    case flag(Bool)
    case list([Loose])
    case fields([String: Loose])
    case blank

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .blank }
        else if let b = try? c.decode(Bool.self) { self = .flag(b) }
        else if let n = try? c.decode(Int.self) { self = .whole(n) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .text(s) }
        else if let a = try? c.decode([Loose].self) { self = .list(a) }
        else { self = .fields(try c.decode([String: Loose].self)) }
    }

    /// The value as a person reads it.
    var said: String {
        switch self {
        case .text(let s): return s
        case .whole(let n): return String(n)
        case .number(let n): return String(n)
        case .flag(let b): return b ? "yes" : "no"
        case .list(let items): return items.map(\.said).joined(separator: ", ")
        case .fields(let f): return f.keys.sorted().map { "\($0): \(f[$0]!.said)" }.joined(separator: "; ")
        case .blank: return "left blank"
        }
    }
}

/// A key's work: the pieces it holds now, and its latest readings.
struct Work: Decodable, Equatable {
    /// A piece the key has claimed and not handed back: the person's Claude is on it.
    struct Held: Decodable, Identifiable, Hashable {
        let problem: String
        let title: String
        let piece: String
        let name: String
        let at: String
        let until: String

        var id: String { piece + at }
    }

    /// What one field of a reading rests on: the page, and the passage where the tracker keeps the page's bytes.
    struct Rest: Decodable, Hashable {
        let field: String
        let url: String
        let passage: String?
    }

    /// A reading beside this one, from another root: its vendor, and how it counts.
    struct Beside: Decodable, Hashable {
        let vendor: String
        let counts: String
        let why: String?
    }

    /// One reading the key signed, with where its piece stands now.
    struct Reading: Decodable, Identifiable, Hashable {
        let problem: String
        let title: String
        let piece: String
        let name: String
        let at: String
        let state: String
        let id: String?
        let vendor: String?
        let counts: String?
        let why: String?
        let `return`: [String: Loose]?
        let rests: [Rest]?
        let beside: [Beside]?

        /// The reading's name on this phone: its event's id, or its piece and time where the layer names none.
        var key: String { id ?? piece + at }

        /// The return's fields in a steady order, the short ones first, so a verdict leads its quote.
        var fields: [(name: String, value: String)] {
            (`return` ?? [:]).map { (name: $0.key, value: $0.value.said) }
                .sorted { ($0.value.count, $0.name) < ($1.value.count, $1.name) }
        }

        /// The answer in one line: the shortest field that is words, which is the verdict where a return has one.
        var answer: String? {
            let worded = (`return` ?? [:]).compactMap { field -> String? in
                if case .text(let s) = field.value, !s.isEmpty { return s }
                return nil
            }
            return worded.min { ($0.count, $0) < ($1.count, $1) } ?? fields.first?.value
        }

        /// The vendors of the readings beside this one that count with it.
        var agreeing: [String] { (beside ?? []).filter { $0.counts == "counted" }.map { Vendor.name($0.vendor) } }

        /// Where the reading stands, as one of a few kinds a row can colour and a banner can announce.
        var standing: Standing {
            switch counts {
            case "struck": return .struck
            case "aside": return .aside
            case "kept": return .kept
            default: break
            }
            switch state {
            case "accepted", "accepted_provisional": return .agreed
            case "recorded": return .recorded
            case "disputed", "challenged": return .differs
            default: return .waiting
            }
        }

        /// Where the reading stands, in a sentence.
        var story: String {
            switch standing {
            case .struck: return "This reading was struck: \(why ?? "a decision went against its set")."
            case .aside: return "Set aside: \(why ?? "it rests on nothing where another reading rests on the record"). It stays on the record."
            case .kept: return "Kept on the record, and it counts for nothing on this piece: \(why ?? "the piece had its readings")."
            case .agreed:
                let who = agreeing.isEmpty ? "A second AI" : Vendor.list(agreeing)
                return state == "accepted"
                    ? "\(who) gave the same answer. The square is settled."
                    : "\(who) gave the same answer. The square is green, and open to challenge for a while."
            case .recorded:
                let n = (beside ?? []).count
                return n == 0 ? "Recorded. Every reading is kept." : "Recorded beside \(n) other reading\(n == 1 ? "" : "s"). Every one is kept."
            case .differs:
                return state == "challenged"
                    ? "The square is challenged. A panel reads it again."
                    : "Another AI read it differently. Both readings are kept, and the piece goes out again."
            case .waiting:
                switch state {
                case "recording": return "Kept. The piece is taking more readings."
                case "judging": return "Kept. A panel is ranking the candidates."
                default: return "Waiting on a second AI from another company."
                }
            }
        }
    }

    enum Standing { case waiting, agreed, recorded, differs, kept, aside, struck }

    let address: String
    let root: String
    let working: [Held]?
    let readings: [Reading]
}

/// A vendor's name as a person knows it.
enum Vendor {
    private static let known = [
        "anthropic": "Anthropic", "openai": "OpenAI", "google": "Google", "mistral": "Mistral", "meta": "Meta",
        "xai": "xAI", "deepseek": "DeepSeek", "human": "a person",
    ]

    static func name(_ vendor: String) -> String {
        known[vendor.lowercased()] ?? vendor.prefix(1).uppercased() + vendor.dropFirst()
    }

    /// "An AI from OpenAI", or "AIs from OpenAI and Google".
    static func list(_ names: [String]) -> String {
        let unique = names.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        guard unique.count > 1 else { return "An AI from \(unique.first ?? "another company")" }
        return "AIs from " + unique.dropLast().joined(separator: ", ") + " and " + unique.last!
    }
}

/// A time as the tracker writes one, with or without the fraction of a second.
func moment(_ written: String) -> Date? {
    let whole = ISO8601DateFormatter()
    let fine = ISO8601DateFormatter()
    fine.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fine.date(from: written) ?? whole.date(from: written)
}

/// Something that happened since the phone last looked: what the banner says, and how it should feel.
struct News: Identifiable, Equatable {
    enum Kind { case took, returned, agreed, differs, other, asked, published }

    let id = UUID()
    let kind: Kind
    let title: String
    let body: String
    /// The state whose colour the banner's square takes.
    let state: String
}

extension Work {
    /// What changed between the work as last seen and the work now, the weightiest first. `seen` maps a reading to
    /// the standing it was last seen in, and `held` is the pieces last seen in Claude's hands.
    func news(since seen: [String: String], held: Set<String>) -> [News] {
        var out: [News] = []
        for r in readings {
            let now = String(describing: r.standing)
            guard seen[r.key] != now else { continue }
            let fresh = seen[r.key] == nil
            switch r.standing {
            case .agreed:
                out.append(News(kind: .agreed, title: fresh ? "Your Claude's answer was matched" : "A second AI agreed",
                                body: "\(r.name): \(r.story)", state: r.state))
            case .differs:
                out.append(News(kind: .differs, title: "Another AI read it differently",
                                body: "\(r.name): both readings are kept on the record.", state: r.state))
            case .recorded:
                out.append(News(kind: .other, title: "Recorded", body: "\(r.name): \(r.story)", state: r.state))
            case .kept, .aside, .struck:
                out.append(News(kind: .other, title: fresh ? "Your Claude handed back an answer" : "A reading changed",
                                body: "\(r.name): \(r.story)", state: r.state))
            case .waiting:
                guard fresh else { continue }
                let said = r.answer.map { "It said: \($0). " } ?? ""
                out.append(News(kind: .returned, title: "Your Claude handed back an answer",
                                body: "\(r.name). \(said)\(r.story)", state: r.state))
            }
        }
        for w in working ?? [] where !held.contains(w.piece) {
            out.append(News(kind: .took, title: "Your Claude took a piece", body: "\(w.name), in \(w.title). It is working on it now.", state: "in_flight"))
        }
        let weight: [News.Kind: Int] = [.agreed: 0, .differs: 1, .returned: 2, .other: 3, .took: 4]
        return out.sorted { (weight[$0.kind] ?? 9) < (weight[$1.kind] ?? 9) }
    }
}
