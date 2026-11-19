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

        /// The answer in a few words: the shortest field that is words where the return has three fields or fewer,
        /// which is the verdict where it has one, and the count of fields where it has more, since no one field of a
        /// long return is its answer.
        var said: String? {
            let all = `return` ?? [:]
            guard !all.isEmpty else { return nil }
            guard all.count <= 3 else { return "\(all.count) fields answered" }
            let worded = all.compactMap { field -> String? in
                if case .text(let s) = field.value, !s.isEmpty { return s }
                return nil
            }
            guard let answer = worded.min(by: { ($0.count, $0) < ($1.count, $1) }) ?? fields.first?.value else { return nil }
            return Plain.value(answer)
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
            default: return .onRecord
            }
        }

        /// Where the answer stands, in a short sentence. An answer is whole once it is signed, so none of these says
        /// that it waits: a match is said of the square, and an answer with none is recorded.
        var story: String {
            let others = (beside ?? []).count
            let more = "\(others) other answer\(others == 1 ? "" : "s")"
            switch standing {
            case .struck: return "Struck, and not counted: \(Plain.reason(why))."
            case .aside: return "Kept, and not counted: \(Plain.reason(why ?? "it rests on nothing where another reading rests on the record"))."
            case .kept: return "Kept, and not counted here: \(Plain.reason(why ?? "the readings the piece asks for stood before it"))."
            case .agreed:
                let who = Vendor.by(agreeing)
                return state == "accepted" ? "Matched by \(who). Final." : "Matched by \(who)."
            case .recorded:
                return others == 0 ? "Recorded." : "Recorded, with \(more)."
            case .differs:
                return state == "challenged"
                    ? "Challenged. A panel is looking again."
                    : "Another AI disagreed. Both answers are kept."
            case .onRecord:
                switch state {
                case "recording": return "Recorded. The piece is collecting more answers."
                case "judging": return "Recorded. A panel is ranking the answers."
                default: return others == 0 ? "Recorded. First answer on this piece." : "Recorded, with \(more) on this piece."
                }
            }
        }
    }

    /// `onRecord` is a reading kept where its piece has no square yet: an answer is whole once it is signed, and a
    /// square is what a second reading may make of it.
    enum Standing { case onRecord, agreed, recorded, differs, kept, aside, struck }

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

    /// The same inside a sentence: "an AI from OpenAI", "AIs from OpenAI and Google", or "another AI" for no name.
    static func by(_ names: [String]) -> String {
        guard !names.isEmpty else { return "another AI" }
        let said = list(names)
        return said.hasPrefix("An ") ? "an " + said.dropFirst(3) : said
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
    enum Kind { case took, returned, agreed, differs, other, asked, sent }

    let id = UUID()
    let kind: Kind
    let title: String
    let body: String
    /// The state whose colour the banner's square takes.
    let state: String
    /// Whether the banner offers to open Claude: what it says is ready in the person's chat there.
    var opensClaude = false
}

extension Work {
    /// The first answer of the person's Claude: the newest reading, where the phone had looked before and seen
    /// none. A phone that has not looked yet marks what is there as seen and says nothing, so an address with
    /// work behind it has no first square.
    func first(since seen: [String: String]) -> Reading? {
        seen.isEmpty ? readings.first : nil
    }

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
                out.append(News(kind: .agreed, title: fresh ? "Your Claude's answer was matched" : "Another AI matched your Claude",
                                body: "\(Plain.piece(r.name)). \(r.story)", state: r.state))
            case .differs:
                out.append(News(kind: .differs, title: "Another AI disagreed",
                                body: "\(Plain.piece(r.name)). Both answers are kept.", state: r.state))
            case .recorded:
                out.append(News(kind: .other, title: "Recorded", body: "\(Plain.piece(r.name)). \(r.story)", state: r.state))
            case .kept, .aside, .struck:
                out.append(News(kind: .other, title: fresh ? "Your Claude answered" : "An answer changed",
                                body: "\(Plain.piece(r.name)). \(r.story)", state: r.state))
            case .onRecord:
                guard fresh else { continue }
                out.append(News(kind: .returned, title: "Your Claude answered",
                                body: "\(Plain.piece(r.name)): \(r.said.map { $0 + ". " } ?? "")\(r.story)", state: r.state))
            }
        }
        for w in working ?? [] where !held.contains(w.piece) {
            // The title is quoted and ends the line, since a title may end in a mark of its own.
            out.append(News(kind: .took, title: "Your Claude took a piece", body: "\(Plain.piece(w.name)), in \u{201C}\(w.title)\u{201D}", state: "in_flight"))
        }
        let weight: [News.Kind: Int] = [.agreed: 0, .differs: 1, .returned: 2, .other: 3, .took: 4]
        return out.sorted { (weight[$0.kind] ?? 9) < (weight[$1.kind] ?? 9) }
    }
}
