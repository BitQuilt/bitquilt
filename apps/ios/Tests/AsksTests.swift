// The asks and the trigger (Sources/Asks.swift): an ask read as the address lists it, a hand-off that names its
// phrase and its problem, the Fire URL and the token taken only as Claude gives them, so a token is sent to
// Anthropic's API and nowhere else, the fire written as Claude's documentation gives it, with no text in it, and
// the Send button's way.
import XCTest
@testable import Quilt

final class AsksTests: XCTestCase {
    private let problem = "sha256:" + String(repeating: "a", count: 64)
    private let fire = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire"
    private let token = "sk-ant-oat01-" + String(repeating: "x", count: 40)

    func testAnAskIsReadAsTheAddressListsIt() throws {
        let json = #"{"asks":[{"id":"00112233445566778899aabbccddeeff","phrase":"take_piece","problem":"\#(problem)","at":"2026-11-16T12:00:00.000Z","handed":null,"sentence":"Open quilt:\#(problem) on Quilt and take a piece.","expires":"2026-11-18T12:00:00.000Z"},{"id":"ffeeddccbbaa99887766554433221100","phrase":"find_something_to_do","problem":null,"at":"2026-11-16T12:01:00.000Z","handed":"2026-11-16T12:02:00.000Z","sentence":"Find me something to do on Quilt.","expires":"2026-11-17T12:02:00.000Z"}]}"#
        struct Listed: Decodable { let asks: [Ask] }
        let asks = try JSONDecoder().decode(Listed.self, from: Data(json.utf8)).asks
        XCTAssertEqual(asks.map(\.title), ["Take a piece", "Find me something to do"])
        XCTAssertEqual(asks.map(\.problem), [problem, nil])
        XCTAssertNil(asks[0].handed)
        XCTAssertNotNil(asks[1].handed)
    }

    func testAHandOffNamesItsPhraseAndItsProblem() throws {
        let taken = HandOff(title: "Take a piece", sentence: "Open quilt:\(problem) on Quilt and take a piece.", phrase: "take_piece", problem: problem)
        XCTAssertTrue(taken.asks)
        // A sentence of the sheet's has its problem read out of it.
        let phrase = try JSONDecoder().decode(Phrase.self, from: Data(#"{"name":"keep_problem","title":"Keep it","say":"Keep quilt:\#(problem)?dn=x on Quilt: seed it, so its pieces come to me first.","about":"The AI seeds it."}"#.utf8))
        let kept = HandOff(phrase: phrase)
        XCTAssertEqual(kept.phrase, "keep_problem")
        XCTAssertEqual(kept.problem, problem)
        XCTAssertTrue(kept.asks)
        // A sentence with words of its own is opened in Claude and not left as an ask.
        XCTAssertFalse(HandOff(title: "Call me", sentence: "Call me Ada on Quilt.", phrase: "call_me").asks)
        XCTAssertFalse(HandOff(title: "A sentence", sentence: "Anything.").asks)
    }

    /// The Send button goes in one tap, by the way the person chose: a new chat in Claude until they choose another,
    /// the chat they have or the background for a sentence an ask carries, and a new chat always for any other
    /// sentence. Giving the trigger makes the background the way, and taking it back returns to a new chat.
    @MainActor
    func testTheSendButtonGoesByTheWayThePersonChose() {
        let store = Store()
        defer {
            store.forgetWake()
            store.route = .new
        }
        var opened: [URL] = []
        store.opener = { opened.append($0) }
        store.forgetWake()
        store.route = .new
        let take = HandOff(title: "Send my Claude", sentence: "Open quilt:\(problem) on Quilt and take a piece.", phrase: "take_piece", problem: problem)
        let words = HandOff(title: "Call me", sentence: "Call me Ada on Quilt.", phrase: "call_me")
        XCTAssertEqual(store.way(for: take), .new)
        store.send(take)
        XCTAssertEqual(opened.count, 1)
        XCTAssertTrue(opened[0].absoluteString.hasPrefix("https://claude.ai/new?q=Open%20quilt"))
        // The chat the person has takes only what an ask carries.
        store.route = .chat
        XCTAssertEqual(store.way(for: take), .chat)
        XCTAssertEqual(store.way(for: words), .new)
        store.send(words)
        XCTAssertEqual(opened.count, 2)
        // The background needs the trigger.
        store.route = .background
        XCTAssertEqual(store.way(for: take), .new)
        XCTAssertTrue(store.keepWake(url: fire, token: token))
        XCTAssertEqual(store.route, .background)
        XCTAssertEqual(store.way(for: take), .background)
        XCTAssertEqual(store.way(for: words), .new)
        store.forgetWake()
        XCTAssertEqual(store.route, .new)
        // Claude where the person left it opens no new chat.
        store.openClaude()
        XCTAssertFalse(opened[2].absoluteString.contains("new"))
        XCTAssertEqual(Route.allCases.map(\.title), ["Open Claude in a new chat", "Use my existing chat", "Run in the background"])
    }

    func testTheFireURLAndTheTokenAreTakenOnlyAsClaudeGivesThem() {
        XCTAssertNotNil(Wake(url: fire, token: token))
        XCTAssertNotNil(Wake(url: "  " + fire + "\n", token: " " + token + " "))
        for bad in [
            "http://api.anthropic.com/v1/claude_code/routines/trig_01/fire",
            "https://api.anthropic.com.example.org/v1/claude_code/routines/trig_01/fire",
            "https://example.org/v1/claude_code/routines/trig_01ABCD/fire",
            "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCD/fire?to=https://example.org",
            "https://api.anthropic.com/v1/messages",
            "https://api.anthropic.com@example.org/v1/claude_code/routines/trig_01ABCD/fire",
            fire + "/again",
            "",
        ] {
            XCTAssertNil(Wake(url: bad, token: token), bad)
        }
        for bad in ["", "password", "sk-ant-", "sk-ant-oat01-with a space", "Bearer " + token] {
            XCTAssertNil(Wake(url: fire, token: bad), bad)
        }
    }

    func testAFireIsWrittenAsClaudeGivesItAndCarriesNoText() throws {
        let request = try XCTUnwrap(Wake(url: fire, token: token)).request
        XCTAssertEqual(request.url?.absoluteString, fire)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-beta"), "experimental-cc-routine-2026-04-01")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
        XCTAssertEqual(request.httpBody, Data("{}".utf8))
        // What a fire answers: the session Claude started.
        let fired = try JSONDecoder().decode(Wake.Fired.self, from: Data(#"{"type":"routine_fire","claude_code_session_id":"session_01","claude_code_session_url":"https://claude.ai/code/session_01"}"#.utf8))
        XCTAssertEqual(fired.url, "https://claude.ai/code/session_01")
    }
}

/// The welcome (Sources/WelcomeView.swift) is in front until Claude is connected, and a person can look around first.
final class WelcomeTests: XCTestCase {
    @MainActor
    func testTheWelcomeIsInFrontUntilThePersonLooksAroundOrClaudeConnects() {
        let store = Store()
        store.forget()
        XCTAssertTrue(store.welcoming)
        // Looking around puts the tabs in front, and a button that needs Claude brings the welcome back.
        store.lookingAround = true
        XCTAssertFalse(store.welcoming)
        store.lookingAround = false
        XCTAssertTrue(store.welcoming)
        // The welcome stays for its last page once Claude has connected, and its button ends it on the page it names.
        store.lookingAround = true
        store.justConnected = true
        XCTAssertTrue(store.welcoming)
        store.finishWelcome(on: "problems")
        XCTAssertFalse(store.welcoming)
        XCTAssertEqual(store.tab, "problems")
    }

    /// A link the keychain holds is found again when the app comes to the front, where the store was made at a moment
    /// the keychain could not be read, as in a start while the phone was still locked since its restart. A phone
    /// that was signed out stays signed out.
    @MainActor
    func testALinkAPhoneCouldNotReadAtTheStartIsReadWhenTheAppComesToTheFront() async {
        #if targetEnvironment(simulator)
            guard UserDefaults.standard.string(forKey: "address") == nil else { return }
            let before = Keychain.read()
            defer { if let before { Keychain.write(before) } else { Keychain.delete() } }
            Keychain.delete()
            let store = Store()
            XCTAssertNil(store.address)
            XCTAssertTrue(store.welcoming)
            // Nothing in the keychain: a refresh finds nothing, and the phone stays signed out.
            await store.refresh()
            XCTAssertNil(store.address)
            // The keychain can be read now.
            Keychain.write("http://localhost:1/mcp/" + String(repeating: "c", count: 64))
            await store.refresh()
            XCTAssertEqual(store.address, "http://localhost:1/mcp/" + String(repeating: "c", count: 64))
            store.forget()
            XCTAssertNil(store.address)
            await store.refresh()
            XCTAssertNil(store.address)
        #endif
    }

    /// The welcome ends on a first piece: its button opens Claude on a new chat with the sentence that finds one,
    /// whatever way the Send button goes by, and the page then waits. The first answer is the newest reading where
    /// the phone had looked before and seen none, and looking at it ends the welcome on the page named.
    @MainActor
    func testTheWelcomeSendsClaudeToAFirstPieceAndTheFirstAnswerIsSaidOnce() throws {
        let store = Store()
        defer { store.route = .new }
        var opened: [URL] = []
        store.opener = { opened.append($0) }
        store.route = .chat
        store.justConnected = true
        XCTAssertFalse(store.sentFirst)
        store.sendFirst()
        XCTAssertTrue(store.sentFirst)
        XCTAssertEqual(opened.map(\.absoluteString), ["https://claude.ai/new?q=Find%20me%20something%20to%20do%20on%20Quilt."])
        XCTAssertTrue(store.welcoming)

        let json = #"{"address":"0x1","root":"0x2","working":[],"readings":[{"problem":"sha256:p","title":"A problem","piece":"sha256:b","name":"claim/2","at":"2026-11-18T12:01:00.000Z","state":"needs_verify","id":"sha256:e2","vendor":"anthropic","counts":"counted","why":null,"return":{"verdict":"supports"},"rests":[],"beside":[]},{"problem":"sha256:p","title":"A problem","piece":"sha256:a","name":"claim/1","at":"2026-11-18T12:00:00.000Z","state":"needs_verify","id":"sha256:e1","vendor":"anthropic","counts":"counted","why":null,"return":{"verdict":"supports"},"rests":[],"beside":[]}]}"#
        let work = try JSONDecoder().decode(Work.self, from: Data(json.utf8))
        // A phone that had looked and seen nothing: the newest answer is the first square.
        XCTAssertEqual(work.first(since: [:])?.name, "claim/2")
        // A phone that had seen an answer has had its first square.
        XCTAssertNil(work.first(since: ["sha256:e1": "onRecord"]))
        let none = try JSONDecoder().decode(Work.self, from: Data(#"{"address":"0x1","root":"0x2","working":[],"readings":[]}"#.utf8))
        XCTAssertNil(none.first(since: [:]))

        store.firstSquare = work.readings.first
        store.sawFirstSquare(then: "you")
        XCTAssertNil(store.firstSquare)
        XCTAssertFalse(store.sentFirst)
        XCTAssertFalse(store.justConnected)
        XCTAssertEqual(store.tab, "you")
    }
}
