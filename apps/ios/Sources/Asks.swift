// What the person asked of their Claude from this app, and the trigger that wakes it (docs/APP.md, What a person asks
// from their own app). A connector answers Claude's calls and starts none, so this app cannot hand Claude a sentence
// through it. What it can do is leave the request where Claude will read it: an ask is kept at the person's address,
// as a phrase's name and a problem's hash and no other words, and Claude lists the asks with its own tool when it next
// takes a turn. The turn comes from a word the person says in Claude, or from the person's own scheduled task in
// Claude, which this app fires: Claude gives such a task a URL and a token, a POST to it starts a session on the
// person's plan with their connectors, and the task's saved prompt reads the asks. The token is kept in this phone's
// keychain and goes to Anthropic's API and nowhere else.
import Foundation
import Security

/// An ask as the address lists it at /mcp/<token>/asks.
struct Ask: Decodable, Identifiable, Hashable {
    let id: String
    let phrase: String
    let problem: String?
    let at: String
    /// When Claude's tool listed it, nil until it has.
    let handed: String?
    /// The sentence Claude is handed, written at the address from the phrase and the hash.
    let sentence: String
    let expires: String

    /// The phrases this app asks with, each by the title a row shows. The address refuses any other.
    static let titles = [
        "take_piece": "Take a piece",
        "open_problem": "Open a problem",
        "my_disputed_return": "My disputed return",
        "find_something_to_do": "Something to do",
        "who_am_i": "Who I am on Quilt",
        "keep_problem": "Keep a problem",
        "give_verdict": "Give my verdict",
        "rank_panel": "Rank a panel",
        "reveal_my_gold": "Reveal my gold",
        "propose_piece": "Propose a piece",
    ]

    var title: String { Ask.titles[phrase] ?? phrase.replacingOccurrences(of: "_", with: " ") }
}

/// The trigger of the person's own scheduled task in Claude: the URL a POST fires, and the token that lets it.
struct Wake: Equatable {
    let url: URL
    let token: String

    /// What the person saves as the task's prompt in Claude. It is their own instruction to their own Claude, and
    /// the only thing the task acts on: nothing this app sends with a fire is read as one.
    static let prompt = "Use the Quilt connector. Call quilt_asked. For each thing it lists, do it as if I had just said that sentence to you here: open the problem, take the piece, do the work its brief asks, and hand the return back with quilt_return. If it lists nothing, stop without doing anything else."

    /// Where a person makes the task, in Claude.
    static let tasks = URL(string: "https://claude.ai/code/routines")!

    /// A fire URL as Claude gives one: https, Anthropic's API, the path of one task's fire, and nothing after it. The
    /// token goes wherever this URL says, so no other host and no other path is taken.
    static func url(_ pasted: String) -> URL? {
        let trimmed = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^https://api\.anthropic\.com/v1/claude_code/routines/[A-Za-z0-9_]{4,80}/fire$"#, options: .regularExpression) != nil
        else { return nil }
        return URL(string: trimmed)
    }

    /// A token as Claude gives one for a task: one word, of the characters a token is written in.
    static func token(_ pasted: String) -> String? {
        let trimmed = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^sk-ant-[A-Za-z0-9_-]{16,400}$"#, options: .regularExpression) != nil else { return nil }
        return trimmed
    }

    init?(url pasted: String, token given: String) {
        guard let url = Wake.url(pasted), let token = Wake.token(given) else { return nil }
        self.url = url
        self.token = token
    }

    /// The fire, as Claude's documentation gives it. The body carries no text: what the task does is in its own
    /// saved prompt and in the asks it reads through the connector. Each fire starts a session of its own, with no
    /// key that makes two the same, so the app fires once for a tap and never again by itself.
    var request: URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("experimental-cc-routine-2026-04-01", forHTTPHeaderField: "anthropic-beta")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = Data("{}".utf8)
        request.timeoutInterval = 20
        return request
    }

    /// What a fire answers: the session Claude started, which Claude's own app opens.
    struct Fired: Decodable {
        let session: String?
        let url: String?

        enum CodingKeys: String, CodingKey {
            case session = "claude_code_session_id"
            case url = "claude_code_session_url"
        }
    }

    /// Fires the task, and answers with the session it started.
    func fire() async throws -> Fired {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let why: String
            switch status {
            case 400: why = "Claude did not start the task. It may be paused in Claude."
            case 401: why = "Claude did not take the token. Make a new one for the task and paste it again."
            case 403: why = "This Claude account cannot start tasks from outside. Scheduled tasks need a paid plan with Claude Code on the web."
            case 404: why = "Claude knows no task at that URL. Copy the task's Fire URL again."
            case 429: why = "Claude has started this task as often as it will for now. It will take another start within the hour."
            default: why = "Claude answered \(status) and did not start."
            }
            throw TrackerError(errorDescription: why, status: status)
        }
        return (try? JSONDecoder().decode(Fired.self, from: data)) ?? Fired(session: nil, url: nil)
    }
}

/// The trigger in this phone's keychain, kept on this device alone: the URL, a line break, the token.
enum WakeStore {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.bitquilt.quilt.wake",
    ]

    static func read() -> Wake? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let text = String(data: data, encoding: .utf8)
        else { return nil }
        let parts = text.split(separator: "\n", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return nil }
        return Wake(url: parts[0], token: parts[1])
    }

    static func write(_ wake: Wake) {
        delete()
        var q = query
        q[kSecValueData as String] = Data((wake.url.absoluteString + "\n" + wake.token).utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
