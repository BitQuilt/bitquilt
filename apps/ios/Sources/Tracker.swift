// The tracker as this app reads it: the join, a person's sheet, the problems and one problem's map, a key's work, the
// root a key counts for, and the identity log this phone's root posts to (docs/PROTOCOL.md, Routes and The on-ramp's
// routes).
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
    /// The standing of the address's key, and the root that key counts for.
    struct Standing: Decodable {
        let standing: Double
        let root: String?
    }

    /// The tracker's record of the AI that connected: when it first did, and when it last did.
    struct Connector: Decodable {
        let first: String
        let last: String
    }

    let state: String
    let address: String?
    let connector: Connector?
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
    var status = 0
}

/// A key as the tracker counts it: the root it signs for, and that root's standing.
struct KeyStanding: Decodable {
    let address: String
    let root: String
    let standing: Double
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
        guard let url = URL(string: address + "/sheet") else { throw TrackerError(errorDescription: "That is not a private link.") }
        return try await answer(URLRequest(url: url))
    }

    /// The problems whose title, slug, statement of done or topics hold every word; every problem for no words.
    static func problems(matching words: String) async throws -> [Problem] {
        struct Found: Decodable { let problems: [Problem] }
        let url = base.appending(path: "search").appending(queryItems: [URLQueryItem(name: "q", value: words)])
        let found: Found = try await answer(URLRequest(url: url))
        return found.problems
    }

    /// One problem by its hash, as the list has it: what a link names (Links.swift).
    static func problem(_ hash: String) async throws -> Problem {
        try await answer(URLRequest(url: base.appending(path: "p/\(hash)/scrape")))
    }

    /// The root a key counts for, and its standing.
    static func standing(of address: String) async throws -> KeyStanding {
        try await answer(URLRequest(url: base.appending(path: "k/\(address)/standing")))
    }

    /// The key's work as the record holds it: the pieces it holds, and its latest readings (Work.swift).
    static func work(of address: String) async throws -> Work {
        let url = base.appending(path: "k/\(address)/work").appending(queryItems: [URLQueryItem(name: "limit", value: "30")])
        return try await answer(URLRequest(url: url))
    }

    /// An event for the identity log. A door that already holds it has taken it.
    static func post(identity event: WireEvent) async throws {
        struct Taken: Decodable { let id: String }
        do {
            let _: Taken = try await answer(posting(event, to: base.appending(path: "k/events")))
        } catch let refusal as TrackerError where refusal.status == 409 {}
    }

    /// A rotation the phone wrote and signed as the new root, for the on-ramp to sign as the old and post.
    static func rotate(at address: String, event: WireEvent) async throws {
        struct Rotated: Decodable { let id: String }
        guard let url = URL(string: address + "/rotate") else { throw TrackerError(errorDescription: "That is not a private link.") }
        do {
            let _: Rotated = try await answer(posting(event, to: url))
        } catch let refusal as TrackerError where refusal.status == 409 {}
    }

    /// The publishes that wait on the root the address's key signs for, the newest first (Draft.swift).
    static func waiting(at address: String) async throws -> [Waiting] {
        struct Listed: Decodable { let waiting: [Waiting] }
        guard let url = URL(string: address + "/waiting") else { throw TrackerError(errorDescription: "That is not a private link.") }
        let listed: Listed = try await answer(URLRequest(url: url))
        return listed.waiting
    }

    /// The root's answer to a draft that waits: its signatures, which publish it, or a decline, which drops it.
    static func answer(_ waiting: Waiting, at address: String, with body: Data) async throws {
        struct Taken: Decodable {}
        guard let url = URL(string: address + "/waiting/" + waiting.id) else { throw TrackerError(errorDescription: "That is not a private link.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = body
        let _: Taken = try await answer(request)
    }

    /// What the person asked from this app and the address still keeps, oldest first (Asks.swift).
    static func asks(at address: String) async throws -> [Ask] {
        struct Listed: Decodable { let asks: [Ask] }
        guard let url = URL(string: address + "/asks") else { throw TrackerError(errorDescription: "That is not a private link.") }
        let listed: Listed = try await answer(URLRequest(url: url))
        return listed.asks
    }

    /// Leaves an ask at the address: a phrase's name and, where the phrase takes one, a problem's hash.
    static func ask(_ phrase: String, problem: String?, at address: String) async throws -> Ask {
        struct Made: Decodable { let ask: Ask }
        guard let url = URL(string: address + "/asks") else { throw TrackerError(errorDescription: "That is not a private link.") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        var body: [String: String] = ["phrase": phrase]
        if let problem { body["problem"] = problem }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let made: Made = try await answer(request)
        return made.ask
    }

    /// Takes an ask back: the address keeps it no longer.
    static func takeBack(_ ask: Ask, at address: String) async throws {
        struct Dropped: Decodable { let dropped: String }
        guard let url = URL(string: address + "/asks/" + ask.id) else { throw TrackerError(errorDescription: "That is not a private link.") }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        let _: Dropped = try await answer(request)
    }

    private static func posting(_ event: WireEvent, to url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = event.posted
        return request
    }

    static func state(of problem: String) async throws -> ProblemState {
        try await answer(URLRequest(url: base.appending(path: "p/\(problem)/state")))
    }

    /// The page of one square, which anyone can open and check.
    static func squarePage(problem: String, piece: String) -> URL {
        base.appending(path: "r/\(problem)/\(piece)")
    }

    /// A problem's link as Quilt makes one (packages/client/src/link.ts, `makeLink`): the hash, the name and this tracker.
    static func link(to problem: Problem) -> String { link(to: problem.problem, slug: problem.slug) }

    static func link(to hash: String, slug: String? = nil) -> String {
        var parts: [String] = []
        if let slug, !slug.isEmpty { parts.append("dn=" + formEncoded(slug)) }
        parts.append("tr=" + formEncoded(base.absoluteString))
        return "quilt:\(hash)?" + parts.joined(separator: "&")
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
            throw TrackerError(errorDescription: why.map { "The tracker says: \($0)." } ?? "The tracker answered \(status).", status: status)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
