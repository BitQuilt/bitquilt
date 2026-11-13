// The tracker as this app reads it: the join, a person's sheet, the problems and one problem's map
// (docs/PROTOCOL.md, Routes and The on-ramp's routes). The app signs nothing; the tracker holds the key.
import Foundation

/// A problem as the tracker's search lists it.
struct Problem: Decodable, Identifiable, Hashable {
    let problem: String
    let title: String
    let slug: String?
    let ownerName: String?
    let doneWhen: String
    let pieces: Int
    let counts: [String: Int]
    let complete: Bool
    let topics: [String]?

    var id: String { problem }
    /// The pieces settled so far: accepted, within the challenge window or past it, or recorded with every reading kept.
    var accepted: Int { (counts["accepted"] ?? 0) + (counts["accepted_provisional"] ?? 0) + (counts["recorded"] ?? 0) }

    enum CodingKeys: String, CodingKey {
        case problem, title, slug, pieces, counts, complete, topics
        case ownerName = "owner_name"
        case doneWhen = "done_when"
    }
}

/// One piece of a problem's state.
struct Piece: Decodable, Identifiable, Hashable {
    let name: String
    let hash: String
    let state: String
    let says: String?

    var id: String { hash }
}

struct ProblemState: Decodable {
    let pieces: [Piece]
}

/// A sentence a person says to their AI, as the sheet gives it.
struct Phrase: Decodable, Identifiable, Hashable {
    let name: String
    let title: String
    let say: String
    let about: String

    var id: String { name + say }
}

struct PhraseGroup: Decodable, Identifiable {
    let title: String
    let phrases: [Phrase]

    var id: String { title }
}

/// A person's sheet at their address: whether an AI has connected, their standing, and the sentences to say.
struct Sheet: Decodable {
    struct Standing: Decodable {
        let standing: Double
    }

    let state: String
    let address: String?
    let first: Phrase
    let groups: [PhraseGroup]
    let standing: Standing?

    var connected: Bool { state == "connected" }
}

struct Joined: Decodable {
    let address: String
    let url: String
}

/// A tracker's refusal, which says why.
private struct Refusal: Decodable {
    let error: String
}

struct TrackerError: LocalizedError {
    let errorDescription: String?
}

struct Tracker {
    /// The tracker's address with its slash. `-tracker <address>` at launch names another, for a run in the simulator.
    static var base: URL {
        let named = UserDefaults.standard.string(forKey: "tracker") ?? ""
        return URL(string: named.isEmpty ? "https://tracker.bitquilt.org/" : named)!
    }

    /// A new address, whose key the tracker makes and holds.
    static func join() async throws -> Joined {
        var request = URLRequest(url: base.appending(path: "join"))
        request.httpMethod = "POST"
        return try await answer(request)
    }

    static func sheet(at address: String) async throws -> Sheet {
        guard let url = URL(string: address + "/sheet") else { throw TrackerError(errorDescription: "That is not an address.") }
        return try await answer(URLRequest(url: url))
    }

    /// The problems whose title, slug, statement of done or topics hold every word; every problem for no words.
    static func problems(matching words: String) async throws -> [Problem] {
        struct Found: Decodable { let problems: [Problem] }
        let url = base.appending(path: "search").appending(queryItems: [URLQueryItem(name: "q", value: words)])
        let found: Found = try await answer(URLRequest(url: url))
        return found.problems
    }

    static func state(of problem: String) async throws -> ProblemState {
        try await answer(URLRequest(url: base.appending(path: "p/\(problem)/state")))
    }

    /// The page of one square, which anyone can open and check.
    static func squarePage(problem: String, piece: String) -> URL {
        base.appending(path: "r/\(problem)/\(piece)")
    }

    /// A problem's link as Quilt makes one (packages/client/src/link.ts, `makeLink`): the hash, the name and this tracker.
    static func link(to problem: Problem) -> String {
        var parts: [String] = []
        if let slug = problem.slug, !slug.isEmpty { parts.append("dn=" + formEncoded(slug)) }
        parts.append("tr=" + formEncoded(base.absoluteString))
        return "quilt:\(problem.problem)?" + parts.joined(separator: "&")
    }

    private static func formEncoded(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "*-._")
        return (s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s).replacingOccurrences(of: "%20", with: "+")
    }

    private static func answer<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let why = (try? JSONDecoder().decode(Refusal.self, from: data))?.error
            throw TrackerError(errorDescription: why.map { "The tracker says: \($0)." } ?? "The tracker answered \(status).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
