// What the app holds: the person's root key, the address their Claude signs through, kept in the keychain since the
// address is its own credential, their sheet as the tracker last gave it, whether Claude's app is on this phone, the
// tab in front, the sentence on its way to Claude, and what came back: their Claude's work as the record holds it,
// asked again every few seconds while the app is in front, with what changed since the phone last looked.
import Foundation
import Observation
import Security
import UIKit

@MainActor
@Observable
final class Store {
    /// `-address <address>` at launch names one for a run in the simulator, as `-tracker` names a tracker.
    private(set) var address: String? = UserDefaults.standard.string(forKey: "address") ?? Keychain.read()
    /// The sheet, the work and the asks are kept on the phone as they change (Kept.swift), under the person's link,
    /// and read back when the app starts, so its pages open on what they last showed.
    private(set) var sheet: Sheet? {
        didSet { if let address { Kept.write("sheet", sheet, for: address) } }
    }
    private(set) var problem: String?
    /// The person's root key, made on this phone and kept in its keychain (Root.swift).
    private(set) var root: Root? = RootStore.read()
    /// Whether Claude's app is on this phone, asked again each time the app comes to the front.
    private(set) var claudeInstalled = Claude.installed
    /// The tab in front: home, problems or you. `-tab you` at launch names one for a run in the simulator.
    var tab = UserDefaults.standard.string(forKey: "tab") ?? "home"
    var handOff: HandOff?
    /// The person chose to look around before setting up, so the welcome stays out of the way until they ask for it.
    var lookingAround = false
    /// Claude connected while the welcome was in front, so the welcome stays for its last page.
    var justConnected = false

    /// Starts on what the phone last read: the person's sheet, their Claude's work and what they sent to Claude,
    /// with the titles of the problems those name. Each is read again as soon as the app is in front.
    init() {
        if let listed: [Problem] = Kept.read("problems") { learn(listed) }
        guard let address else { return }
        sheet = Kept.read("sheet", for: address)
        work = Kept.read("work", for: address)
        asks = Kept.read("asks", for: address) ?? []
        for r in work?.readings ?? [] { titles[r.problem] = r.title }
        for w in work?.working ?? [] { titles[w.problem] = w.title }
    }

    /// Whether the welcome is in front and not the three tabs: no private link is on this phone, or one is and no
    /// AI has connected at it yet, or one just did. While the sheet has not been read, a phone with a link shows
    /// its tabs, so a person who is set up never sees the welcome flash by.
    var welcoming: Bool {
        if justConnected { return true }
        if lookingAround { return false }
        return address == nil || (sheet.map { !$0.connected } ?? false)
    }

    /// The welcome's last button: the tabs come to the front, on the page it names.
    func finishWelcome(on tab: String) {
        justConnected = false
        sentFirst = false
        self.tab = tab
    }

    /// The welcome sent the person's Claude to its first piece, so its last page waits for the answer.
    private(set) var sentFirst = false
    /// The first answer of the person's Claude this phone has seen, said over the whole screen, once.
    var firstSquare: Work.Reading?
    /// The sentence that sends Claude to find a piece, as `phrases.ts` writes it.
    static let find = HandOff(title: "Find me something to do", sentence: "Find me something to do on Quilt.", phrase: "find_something_to_do")

    /// The welcome's own send: Claude opens on a new chat with the sentence that finds a piece, whatever way the
    /// Send button goes by, since the welcome says what the person will see there.
    func sendFirst() {
        sentFirst = true
        open(Store.find)
    }

    /// The first square was looked at: the tabs come to the front, on the page named.
    func sawFirstSquare(then tab: String) {
        firstSquare = nil
        finishWelcome(on: tab)
    }

    /// The work of the key the person's Claude signs with, as the tracker last answered it (Work.swift).
    private(set) var work: Work? {
        didSet { if let address { Kept.write("work", work, for: address) } }
    }
    /// What changed last, shown as a banner until it is tapped or a few seconds pass.
    var news: News?
    /// The readings that changed since the Activity page was last looked at.
    private(set) var fresh = Set(UserDefaults.standard.stringArray(forKey: "fresh") ?? [])
    /// What waits on this phone's root: the problems the person's Claude drafted, each published once the root signs
    /// it (Draft.swift).
    private(set) var waiting: [Waiting] = []
    /// What the person asked of their Claude from this app and the address still keeps (Asks.swift).
    private(set) var asks: [Ask] = [] {
        didSet { if let address { Kept.write("asks", asks, for: address) } }
    }
    /// The trigger of the person's own scheduled task in Claude, where they gave this app one (Asks.swift).
    private(set) var wake: Wake? = WakeStore.read()
    /// When this app last started the person's Claude, and the session Claude said it started.
    private(set) var woke: Date?
    private(set) var run: URL?
    /// Counts each change of the work, so a map on screen knows to read its problem again.
    private(set) var pulse = 0
    /// The titles of the problems this phone has seen, by hash, so a thing sent to Claude can name its problem: an
    /// ask carries a problem's hash and no words.
    private(set) var titles: [String: String] = [:]

    /// Remembers the titles of problems a page has read.
    func learn(_ problems: [Problem]) {
        for p in problems { titles[p.problem] = p.title }
    }
    /// The answer in front, over whatever page is: opened from its row, its square or a link.
    var reading: Work.Reading?
    /// A problem a link named, which the Problems page opens, with the square to show on it (Links.swift).
    var visit: Visit?
    /// How the Send button reaches the person's Claude. A new chat until the person chooses another way, and the
    /// background from when they give this app their task's trigger.
    var route = Route(rawValue: UserDefaults.standard.string(forKey: "route") ?? "") ?? .new {
        didSet { UserDefaults.standard.set(route.rawValue, forKey: "route") }
    }
    /// Opens a page in another app: Claude's. A test puts its own in to see what would open.
    var opener: (URL) -> Void = { UIApplication.shared.open($0) }
    /// When a sentence last went to Claude: for a few minutes after, the tracker is asked more often.
    private var expecting: Date?
    /// When the list of problems was last read for the titles an ask needs.
    private var learnedAt: Date?

    /// The pieces the person's Claude has read or holds, which a map marks as theirs.
    var mine: Set<String> { Set((work?.readings ?? []).map(\.piece) + (work?.working ?? []).map(\.piece)) }
    /// The pieces their Claude holds now.
    var holding: Set<String> { Set((work?.working ?? []).map(\.piece)) }
    /// How many answers their Claude gave on each problem, by the problem's hash.
    var answered: [String: Int] { Dictionary((work?.readings ?? []).map { ($0.problem, 1) }, uniquingKeysWith: +) }
    /// What the Home tab's badge counts: what waits on the person, and, while the page is not in front, what
    /// changed since it was.
    var unseen: Int { waiting.count + (tab == "home" ? 0 : fresh.count) }

    /// Whether an AI has connected at this address: the tracker records the first time one does, so the sheet says
    /// whether Quilt is in the person's Claude.
    var connected: Bool { sheet?.connected ?? false }

    /// Whether the key behind the address signs for this phone's root, as the tracker counts it: the sheet names the
    /// root the address's key counts for.
    var phoneHoldsRoot: Bool {
        guard let mine = root?.key?.address, let counted = sheet?.standing?.root else { return false }
        return mine == counted
    }

    /// Makes the root here where there is none, makes an address at the tracker, and says at once, as the root, that
    /// the address's key signs for it: the key has signed nothing yet, which a delegation asks.
    func join() async {
        await attempt {
            let key = try self.signing()
            let joined = try await Tracker.join()
            self.keep(joined.url)
            try await Identity.delegate(key, to: joined.address)
        }
        await refresh()
    }

    /// Puts an address whose key the tracker holds as a root under this phone's key. A root that has signed nothing
    /// takes it by a rotation, and everything the address did becomes this phone's. A root that has signed can only
    /// delegate, which stands where the address has signed nothing, as after a join whose delegation did not arrive.
    func bringHome() async {
        guard let address, let key = sheet?.address else { return }
        await attempt {
            let rotates = !(self.root?.signed ?? false) || self.root?.took == key
            let mine = try self.signing(taking: rotates ? key : nil)
            if rotates {
                try await Identity.rotate(at: address, from: key, to: mine)
            } else {
                try await Identity.delegate(mine, to: key)
            }
        }
        await refresh()
    }

    /// Ends the tracker's key: from the revoke's receipt it signs for this phone's root no longer. The address is taken
    /// off this phone, since nothing signed through it would count. Work already accepted stays the root's.
    func revoke() async {
        guard let key = sheet?.address else { return }
        var ended = false
        await attempt {
            try await Identity.revoke(try self.signing(), of: key)
            ended = true
        }
        if ended { forget() }
    }

    /// The root's key for an act that signs, made and kept where there is none, and marked as having signed before it
    /// does, with the address a rotation takes, so a post whose answer was lost is not taken for one never made.
    private func signing(taking: String? = nil) throws -> SigningKey {
        var held = try root ?? RootStore.make()
        guard let key = held.key else { throw WireError(errorDescription: "The key in this phone's keychain is not one.") }
        if !held.signed || (taking != nil && held.took != taking) {
            held.signed = true
            if let taking { held.took = taking }
            RootStore.write(held)
        }
        root = held
        return key
    }

    /// Keeps an address the person already holds, once the tracker answers its sheet.
    func use(_ pasted: String) async {
        let trimmed = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^https?://\S+/mcp/[0-9a-f]{64}$"#, options: .regularExpression) != nil else {
            problem = "A private link ends in /mcp/ and sixty-four letters and digits."
            return
        }
        await attempt {
            self.sheet = try await Tracker.sheet(at: trimmed)
            self.keep(trimmed)
        }
    }

    /// Looks again: whether Claude's app is on this phone, and the sheet, which says whether an AI has connected, the
    /// standing and the sentences.
    func refresh() async {
        claudeInstalled = Claude.installed
        guard let address else { return }
        await attempt { self.sheet = try await Tracker.sheet(at: address) }
    }

    /// Asks the tracker every few seconds until an AI has connected, so the page moves on by itself once Quilt is in
    /// Claude. A read that fails is tried again and says nothing.
    func awaitConnection() async {
        while let address, !connected, !Task.isCancelled {
            if let sheet = try? await Tracker.sheet(at: address) {
                // The welcome sees the connection happen, and stays for its last page.
                if sheet.connected, welcoming { justConnected = true }
                self.sheet = sheet
            }
            if connected { break }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    /// A sentence is on its way to Claude, or the person is back, so the work is asked for every few seconds for a while.
    func expect() { expecting = Date() }

    /// Follows a link that opened the app (Links.swift). A square of the person's own Claude's opens on its answer,
    /// read again first, since the link may be seconds older than the answer; any other square opens on its
    /// problem's map with that square chosen, and a problem's link on its page. A person who has not set up sees
    /// what the link names and not the welcome. Whether the link was one this app follows.
    @discardableResult
    func follow(_ url: URL) async -> Bool {
        guard let opened = Opened(url) else { return false }
        if welcoming { lookingAround = true }
        justConnected = false
        switch opened {
        case .problem(let hash):
            visit = Visit(problem: hash, piece: nil)
            tab = "problems"
        case .square(let problem, let piece):
            await look()
            if let mine = work?.readings.first(where: { $0.problem == problem && $0.piece == piece }) {
                tab = "home"
                // The first square is already said over the whole screen, and is this answer.
                if firstSquare == nil { reading = mine }
            } else {
                visit = Visit(problem: problem, piece: piece)
                tab = "problems"
            }
        }
        return true
    }

    /// The way a sentence goes when the Send button is pressed: the person's chosen way where the sentence is one an
    /// ask carries, and a new chat for any other sentence, since only an ask can be left at the address. The
    /// background needs the trigger; without it the sentence goes to a new chat.
    func way(for handOff: HandOff) -> Route {
        guard handOff.asks else { return .new }
        return route == .background && wake == nil ? .new : route
    }

    /// Sends a sentence to the person's Claude in one tap, by the way they chose.
    func send(_ handOff: HandOff) {
        switch way(for: handOff) {
        case .new: open(handOff)
        case .chat: Task { await ask(handOff, waking: false) }
        case .background: Task { await ask(handOff, waking: true) }
        }
    }

    /// Opens Claude on a new chat with the sentence written in, and copies the sentence in case Claude opens
    /// without it.
    func open(_ handOff: HandOff) {
        UIPasteboard.general.string = handOff.sentence
        expect()
        opener(Claude.chat(saying: handOff.sentence))
    }

    /// Opens Claude where the person left it, for the chat they already have.
    func openClaude() {
        expect()
        opener(Claude.app)
    }

    /// Asks the tracker for the work while the app is in front: every three seconds for five minutes after the app
    /// came to the front or a sentence went to Claude, and while Claude holds a piece; every five while an answer
    /// is on the record with no square yet, since another reading may come; every twenty otherwise. The task that
    /// runs it ends it.
    func watch() async {
        expect()
        while !Task.isCancelled {
            await look()
            let lately = expecting.map { Date().timeIntervalSince($0) < 300 } ?? false
            let waiting = (work?.readings ?? []).contains { $0.standing == .onRecord } || asks.contains { $0.handed == nil }
            try? await Task.sleep(for: .seconds(lately || !holding.isEmpty ? 3 : waiting ? 5 : 20))
        }
    }

    /// One look: what waits on this phone's root, then the work. What changed since the last look is said as news,
    /// a draft that waits before anything else, and a reading that changed is marked fresh until the Activity page is
    /// looked at. The first look on a phone marks everything seen and says nothing. A read that fails is tried again
    /// at the next look and says nothing.
    func look() async {
        guard let address else { return }
        if sheet == nil, let read = try? await Tracker.sheet(at: address) { sheet = read }
        let asked = await lookForDrafts(at: address)
        await lookForAsks(at: address)
        guard let key = sheet?.address, let now = try? await Tracker.work(of: key), now != work else { return }
        let defaults = UserDefaults.standard
        let seen = defaults.dictionary(forKey: "seen") as? [String: String]
        let held = Set(defaults.stringArray(forKey: "held") ?? [])
        let stands = Dictionary(now.readings.map { ($0.key, String(describing: $0.standing)) }) { a, _ in a }
        defaults.set(stands, forKey: "seen")
        defaults.set((now.working ?? []).map(\.piece), forKey: "held")
        work = now
        for r in now.readings { titles[r.problem] = r.title }
        for w in now.working ?? [] { titles[w.problem] = w.title }
        pulse += 1
        guard let seen else { return }
        fresh.formUnion(stands.filter { seen[$0.key] != $0.value }.keys)
        defaults.set(Array(fresh), forKey: "fresh")
        // The first answer is said over the whole screen and not as a banner. A match moves the score, which the
        // sheet carries.
        if let first = now.first(since: seen) {
            firstSquare = first
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            if let read = try? await Tracker.sheet(at: address) { sheet = read }
            return
        }
        guard !asked, let first = now.news(since: seen, held: held).first else { return }
        // The welcome's last page says itself that Claude took its first piece.
        if sentFirst, first.kind == .took { return }
        say(first)
        // An agreement moves the standing, which the sheet carries.
        if first.kind == .agreed, let read = try? await Tracker.sheet(at: address) { sheet = read }
    }

    /// Reads what waits on this phone's root, and says a draft it has not said before. Whether it said one.
    private func lookForDrafts(at address: String) async -> Bool {
        guard let mine = root?.key?.address, let listed = try? await Tracker.waiting(at: address) else { return false }
        let now = listed.filter { $0.root == mine }
        guard now != waiting else { return false }
        waiting = now
        let said = Set(UserDefaults.standard.stringArray(forKey: "asked") ?? [])
        UserDefaults.standard.set(now.map(\.id), forKey: "asked")
        guard let draft = now.first(where: { !said.contains($0.id) }) else { return false }
        let title = (try? Draft(draft, root: mine))?.title
        say(News(kind: .asked, title: "Your Claude drafted a problem",
                 body: (title.map { "\($0). " } ?? "") + "Read it, and publish it if it is right.", state: "open"))
        return true
    }

    /// Reads the asks the address keeps, and says so when the person's Claude has picked one up since the last look.
    private func lookForAsks(at address: String) async {
        guard let listed = try? await Tracker.asks(at: address) else { return }
        await learnTitles(for: listed)
        guard listed != asks else { return }
        let waited = Set(asks.filter { $0.handed == nil }.map(\.id))
        asks = listed
        guard let picked = listed.first(where: { $0.handed != nil && waited.contains($0.id) }) else { return }
        say(News(kind: .sent, title: "Your Claude picked it up", body: "\(picked.title). Its answer will show up here.", state: "in_flight"))
    }

    /// Reads the list of problems once where an ask names a problem this phone has not seen, so the ask can say
    /// which problem it is about. Asked at most once a minute.
    private func learnTitles(for asks: [Ask]) async {
        guard asks.contains(where: { $0.problem.map { titles[$0] == nil } ?? false }) else { return }
        if let learnedAt, Date().timeIntervalSince(learnedAt) < 60 { return }
        learnedAt = Date()
        if let listed = try? await Tracker.problems(matching: "") { learn(listed) }
    }

    /// Leaves a hand-off at the address as an ask, and where `waking` and a trigger is kept, starts the person's
    /// Claude. Whether the ask was kept. A start that fails leaves the ask waiting, and the banner says why.
    func ask(_ handOff: HandOff, waking: Bool) async -> Bool {
        guard let address, let phrase = handOff.phrase else { return false }
        var kept = false
        await attempt {
            let made = try await Tracker.ask(phrase, problem: handOff.problem, at: address)
            self.asks.removeAll { $0.id == made.id }
            self.asks.append(made)
            kept = true
        }
        // What was asked, as a banner names it: the ask's own title, with the problem's where the page knew it.
        let label = (Ask.titles[phrase] ?? handOff.title) + (handOff.named.map { ": \($0)" } ?? "")
        guard kept else {
            say(News(kind: .sent, title: "That did not go through", body: problem ?? "Quilt could not be reached. Try again.", state: "disputed"))
            return false
        }
        expect()
        guard waking, let wake else {
            say(News(kind: .sent, title: "Ready in your Quilt chat", body: "\(label). Tap its button on Quilt\u{2019}s card there.", state: "open", opensClaude: true))
            return true
        }
        do {
            let fired = try await wake.fire()
            woke = Date()
            run = fired.url.flatMap { URL(string: $0) }
            say(News(kind: .sent, title: "Your Claude is starting", body: "\(label). Its answer will show up here.", state: "in_flight"))
        } catch {
            say(News(kind: .sent, title: "Claude did not start", body: "\(error.localizedDescription) What you asked is saved for your Quilt chat.", state: "disputed"))
        }
        return true
    }

    /// Takes an ask back before the person's Claude has read it.
    func takeBack(_ ask: Ask) async {
        guard let address else { return }
        await attempt {
            try await Tracker.takeBack(ask, at: address)
            self.asks.removeAll { $0.id == ask.id }
        }
    }

    /// Keeps the trigger of the person's scheduled task in this phone's keychain. Whether the two are a Fire URL and
    /// a token as Claude gives them.
    func keepWake(url: String, token: String) -> Bool {
        guard let made = Wake(url: url, token: token) else { return false }
        WakeStore.write(made)
        wake = made
        // The trigger was given so that a tap is enough, so the Send button uses it from now.
        route = .background
        return true
    }

    /// Forgets the trigger: a tap opens Claude with a sentence again.
    func forgetWake() {
        WakeStore.delete()
        wake = nil
        woke = nil
        run = nil
        if route == .background { route = .new }
    }

    /// Starts the person's task once with nothing asked, to see that Claude takes the trigger. What happened, in a
    /// sentence.
    func tryWake() async -> String {
        guard let wake else { return "Nothing is set up on this phone." }
        do {
            let fired = try await wake.fire()
            woke = Date()
            run = fired.url.flatMap { URL(string: $0) }
            return "It works. Claude started the task."
        } catch {
            return error.localizedDescription
        }
    }

    /// Publishes a draft: the person is asked for, the root signs the envelope and its version, and the address
    /// posts them. Whether it was published.
    func publish(_ draft: Draft) async -> Bool {
        guard let address, await Presence.confirm("Publish \u{201C}\(draft.title)\u{201D}.") else { return false }
        var done = false
        await attempt {
            try await Tracker.answer(draft.waiting, at: address, with: draft.answer(signedBy: try self.signing()))
            done = true
        }
        guard done else { return false }
        waiting.removeAll { $0.id == draft.waiting.id }
        pulse += 1
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        return true
    }

    /// Drops a draft: nothing is signed, and the address keeps it no longer.
    func decline(_ draft: Waiting) async {
        guard let address else { return }
        await attempt {
            try await Tracker.answer(draft, at: address, with: Data(#"{"decline":true}"#.utf8))
            self.waiting.removeAll { $0.id == draft.id }
        }
    }

    private func say(_ news: News) {
        self.news = news
        UINotificationFeedbackGenerator().notificationOccurred(news.kind == .differs ? .warning : .success)
    }

    /// The Activity page was looked at: nothing on it is fresh any more.
    func sawActivity() {
        fresh = []
        UserDefaults.standard.removeObject(forKey: "fresh")
    }

    /// Takes the address off this phone. The root stays in the keychain, and the address's key stays at the tracker,
    /// reached by the address alone. What this phone had seen of the address's work goes with it.
    func forget() {
        Keychain.delete()
        address = nil
        sheet = nil
        lookingAround = false
        unsee()
    }

    private func unsee() {
        work = nil
        asks = []
        waiting = []
        fresh = []
        Kept.clear()
        for name in ["seen", "held", "fresh", "asked"] { UserDefaults.standard.removeObject(forKey: name) }
    }

    func clearProblem() { problem = nil }

    private func keep(_ url: String) {
        Keychain.write(url)
        address = url
        unsee()
    }

    private func attempt(_ work: () async throws -> Void) async {
        do {
            try await work()
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// A way a sentence reaches the person's Claude: a new chat in Claude with the sentence written in, the chat they
/// already have, where it shows as a button on Quilt's card, or their scheduled task, started in the background.
enum Route: String, CaseIterable, Identifiable {
    case new, chat, background

    var id: String { rawValue }

    /// The way as a button names it.
    var title: String {
        switch self {
        case .new: return "Open Claude in a new chat"
        case .chat: return "Use my existing chat"
        case .background: return "Run in the background"
        }
    }

    /// The way in a few words, for a list of choices.
    var short: String {
        switch self {
        case .new: return "New chat"
        case .chat: return "My chat"
        case .background: return "Background"
        }
    }

    /// What pressing Send does by this way, in a line under the button.
    var hint: String {
        switch self {
        case .new: return "Opens Claude on a new chat."
        case .chat: return "Shows as a button on Quilt\u{2019}s card in your chat."
        case .background: return "Your Claude does it in the background."
        }
    }
}

/// The one item this app keeps in the keychain: the person's address.
enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.bitquilt.quilt.address",
    ]

    static func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) {
        delete()
        var q = query
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
