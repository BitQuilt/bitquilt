// API.swift: the shapes the node answers with on 127.0.0.1 and the calls the shell makes. The shell reads, and writes
// two things that are not the ledger's: it asks the node to write the connector into Claude Desktop's config
// (POST /api/install), and it runs `quilt init` to make the key. Every write to a ledger stays in the person's AI's
// connector, or in the page, which is the person's hand. Requests carry no Origin header, which is what the node's guard
// expects of a program on this machine.

import Foundation

/// GET /api/me: whose node this is and what it knows.
struct Me: Decodable {
    let address: String?
    let name: String?
    let model: String
    let can: [String]
    let trackers: [String]
    let mirrors: [String]
    let relays: [String]
    let queued: Int
    let problems: Int
}

/// One line of GET /api/search?q=: a problem an index or a relay answered with, and its link for a phrase.
struct SearchResult: Decodable, Identifiable {
    let problem: String
    let title: String
    let slug: String
    let owner: String
    let pieces: Int?
    let counts: [String: Int]?
    let topics: [String]?
    let tracker: String?
    let via: String
    let link: String
    var id: String { problem }
}

/// GET /api/standing: the key's standing and coin as the trackers compute them (QX-1, QX-15, QX-17); either absent where no tracker answers or carries one.
struct Standing: Decodable {
    struct Points: Decodable {
        let standing: Int
        let locked: Int
        let free: Int
        let tracker: String
    }

    /// What the open epoch would mint to this key if it ended now, and when it ends.
    struct Pending: Decodable {
        let amount: Int
        let pays_at: String
    }

    struct Coin: Decodable {
        let balance: Int
        let vested: Int
        let pending: Pending?
        /// What a transfer or a redeem could move now: the smaller of free and vested.
        let free_vested: Int
        let unvested: Int
        let locked: Int
        let escrowed: Int
        let free: Int
        let home: String
    }

    let standing: Points?
    let coin: Coin?
}

/// One item of GET /api/attention: something a piece wants from this person in particular.
struct AttentionItem: Decodable {
    let problem: String
    let title: String
    let piece: String?
    let name: String?
    let why: String
    let tracker: String?
}

/// GET /api/phrases: the sheet (phrases.ts in the client). Which of three states the home is in, the first phrase to say,
/// the phrases that fit this person, every prompt the connector offers, and each phrase as a template with its arguments in braces.
struct Sheet: Decodable {
    struct Problem: Decodable { let hash: String; let title: String }

    struct Phrase: Decodable, Identifiable {
        let name: String
        let title: String
        let say: String
        let about: String
        let problem: Problem?
        var id: String { say }
    }

    struct Group: Decodable, Identifiable {
        let title: String
        let phrases: [Phrase]
        var id: String { title }
    }

    struct Connector: Decodable { let host: String?; let first: String; let last: String }
    struct Claude: Decodable { let installed: Bool; let config: String; let running: Bool }

    struct Prompt: Decodable, Identifiable {
        let name: String
        let title: String
        let about: String
        let args: [String]
        var id: String { name }
    }

    /// no_key, no_connector or connected.
    let state: String
    let address: String?
    let name: String?
    let connector: Connector?
    let claude: Claude
    let first: Phrase
    /// "due" while the key's twelve words, kept at first use, wait on the page to be written down.
    let backup: String?
    let groups: [Group]
    let prompts: [Prompt]
    let templates: [String: String]

    /// A template said about a link: `{link}` filled, as the node's own `say` would fill it.
    func say(_ name: String, link: String) -> String? {
        templates[name]?.replacingOccurrences(of: "{link}", with: link)
    }
}

/// POST /api/install: whether the node wrote the connector into Claude Desktop's config, and where, or why not.
struct Installed: Decodable {
    let file: String
    let written: Bool
    let reason: String?
}

struct API {
    /// The node's origin, http://127.0.0.1:<port>, with no trailing slash.
    let base: String

    enum Failure: LocalizedError {
        case status(Int)
        case said(String)
        case badURL

        var errorDescription: String? {
            switch self {
            case .status(let code): return "The node answered \(code)."
            case .said(let message): return message
            case .badURL: return "The address could not be formed."
            }
        }
    }

    private struct Answer {
        let data: Data
        let status: Int
    }

    private struct Said: Decodable { let error: String }
    private struct Found: Decodable { let problems: [SearchResult] }
    private struct Wanted: Decodable { let items: [AttentionItem] }

    func me() async throws -> Me {
        try decode(await get("/api/me", timeout: 3))
    }

    /// The trackers and relays this client knows, asked at once; this can take a while.
    func search(_ words: String) async throws -> [SearchResult] {
        let found: Found = try decode(await get("/api/search", query: [URLQueryItem(name: "q", value: words)], timeout: 25))
        return found.problems
    }

    /// Nil on a node that has no standing route yet (404), so the line stays absent.
    func standing() async throws -> Standing? {
        let answer = try await get("/api/standing", timeout: 10)
        if answer.status == 404 { return nil }
        return try decode(answer)
    }

    /// Empty on a node that has no attention route yet (404), so the count stays absent.
    func attention() async throws -> [AttentionItem] {
        let answer = try await get("/api/attention", timeout: 10)
        if answer.status == 404 { return [] }
        let wanted: Wanted = try decode(answer)
        return wanted.items
    }

    /// The sheet; nil on a node from before the sheet existed (404). Once an AI has connected the node asks the trackers for what is wanted, so this can take a while.
    func sheet() async throws -> Sheet? {
        let answer = try await get("/api/phrases", timeout: 20)
        if answer.status == 404 { return nil }
        return try decode(answer)
    }

    /// Asks the node to write the connector into Claude Desktop's config; the node refuses while Claude runs unless told to go ahead anyway.
    func install(anyway: Bool) async throws -> Installed {
        try decode(await post("/api/install", body: ["anyway": anyway], timeout: 10))
    }

    /// Whether a quilt node answers at the base: JSON with an address field, null or not.
    func answers() async -> Bool {
        guard let answer = try? await get("/api/me", timeout: 1.5), answer.status == 200,
              let object = try? JSONSerialization.jsonObject(with: answer.data) as? [String: Any] else { return false }
        return object.keys.contains("address")
    }

    private func get(_ path: String, query: [URLQueryItem] = [], timeout: TimeInterval) async throws -> Answer {
        guard var parts = URLComponents(string: base + path) else { throw Failure.badURL }
        if !query.isEmpty { parts.queryItems = query }
        guard let url = parts.url else { throw Failure.badURL }
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        let (data, response) = try await URLSession.shared.data(for: request)
        return Answer(data: data, status: (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func post(_ path: String, body: [String: Any], timeout: TimeInterval) async throws -> Answer {
        guard let url = URL(string: base + path) else { throw Failure.badURL }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        return Answer(data: data, status: (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    /// The body as the shape asked for; on any other status, the node's own sentence when it gave one.
    private func decode<T: Decodable>(_ answer: Answer) throws -> T {
        guard answer.status == 200 else {
            if let said = try? JSONDecoder().decode(Said.self, from: answer.data) { throw Failure.said(said.error) }
            throw Failure.status(answer.status)
        }
        return try JSONDecoder().decode(T.self, from: answer.data)
    }
}
