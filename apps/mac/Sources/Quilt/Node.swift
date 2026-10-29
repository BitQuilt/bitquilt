// Node.swift: owning or attaching to the node, and what the popover reads of it. On launch the shell reads the port from
// $QUILT_HOME/config.json, asks /api/me, attaches when a node answers and otherwise starts one as a child with its output
// in ~/Library/Logs/Quilt/node.log. Every thirty seconds it asks again, and starts a node when the one it had is gone.
// Quitting stops only a node this app started. The popover reads this object: the sheet (which state the home is in and
// the phrases to say), the coin as it rises, what is wanted. Three things here act: `makeKey` runs `quilt init` once for
// a home with no key, `installConnector` hands the connector bundle to Claude Desktop, and `setAway` asks the node to
// schedule, or stop, the hourly run while the person is away. Nothing here signs, and nothing writes to a ledger.

import AppKit
import Foundation

@MainActor
final class Node: ObservableObject {
    enum Status: Equatable {
        case probing, starting, attached, started
        case failed(String)
    }

    /// Which screen the popover shows: the sheet's state; that the node is not up yet; or that the node answering is an older one with no sheet to give.
    enum Screen: Equatable {
        case down, old, noKey, noConnector, connected
    }

    @Published private(set) var status: Status = .probing
    @Published private(set) var me: Me?
    @Published private(set) var sheet: Sheet?
    /// True when the node answered the sheet's route with nothing: a node from before the sheet, started by something else.
    @Published private(set) var sheetMissing = false
    @Published private(set) var attention: [AttentionItem] = []
    @Published private(set) var standing: Standing?
    /// Units of coin gained since this app was opened: every rise of the balance, summed, so the person sees the day pay.
    @Published private(set) var gained = 0
    /// When the balance last rose, for the popover to light the rise for a moment.
    @Published private(set) var risenAt: Date?
    /// The recovery phrase `quilt init` printed, shown once and then let go.
    @Published private(set) var newPhrase: String?
    @Published private(set) var keyNote: String?
    @Published private(set) var installed: Installed?
    @Published private(set) var installNote: String?
    /// The bundle was handed to Claude Desktop this session: it is asking, or has asked, to install Quilt.
    @Published private(set) var bundleOpened = false
    /// Claude Desktop is not on this Mac, so there is nothing to hand the bundle to.
    @Published private(set) var claudeMissing = false
    /// The run while away (GET /api/away): nil until the node has answered, and on a node from before it.
    @Published private(set) var away: Away?
    /// What the node said when the switch was last moved, or what went wrong.
    @Published private(set) var awayNote: String?

    let home: URL
    let port: Int
    let api: API
    let logURL: URL
    private var child: Process?
    private var startingNow = false
    private var timers: [Timer] = []
    private var balanceTimer: Timer?
    private var lastBalance: Int?

    init() {
        home = Node.quiltHome()
        port = Node.port(home: home)
        api = API(base: "http://127.0.0.1:\(port)")
        logURL = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Logs/Quilt/node.log")
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.stop() }
        }
        timers = [
            Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.tick() }
            },
            Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.refreshSheet() }
            },
        ]
        watchBalance(open: false)
        Task { await connect() }
    }

    // MARK: What the views read

    var isUp: Bool { status == .attached || status == .started }

    var screen: Screen {
        guard isUp else { return .down }
        guard let sheet else { return sheetMissing ? .old : .down }
        switch sheet.state {
        case "no_key": return .noKey
        case "no_connector": return .noConnector
        default: return .connected
        }
    }

    var statusText: String {
        switch status {
        case .probing: return "looking for the node"
        case .starting: return "starting the node"
        case .attached: return "attached to a node already running"
        case .started: return "node started by Quilt"
        case .failed(let why): return why
        }
    }

    /// The name the person chose, else the start of their address, else nothing.
    var who: String {
        if let name = me?.name, !name.isEmpty { return name }
        if let address = me?.address { return String(address.prefix(10)) }
        return ""
    }

    /// The coin this key holds at the coin's home, as the tracker last said; nil where no tracker carries one.
    var coin: Standing.Coin? { standing?.coin }

    /// The standing in points, as the tracker last said.
    var points: Standing.Points? { standing?.standing }

    /// Whether the balance rose in the last ten seconds, so the rise can be lit.
    var risenLately: Bool {
        guard let risenAt else { return false }
        return Date().timeIntervalSince(risenAt) < 10
    }

    /// The page's address with a fragment the page reads: open=<link>, any, or none.
    func pageURL(fragment: String?) -> URL {
        var parts = URLComponents(string: api.base + "/")!
        parts.fragment = fragment
        return parts.url!
    }

    // MARK: The node

    func connect() async {
        if await api.answers() {
            status = .attached
            await refresh()
        } else {
            await startNode()
        }
    }

    /// Every thirty seconds: a node that answers keeps its standing; one that is gone is started again.
    func tick() async {
        if await api.answers() {
            if !isUp { status = child?.isRunning == true ? .started : .attached }
            return
        }
        if status == .starting || child?.isRunning == true { return }
        await startNode()
    }

    func refresh() async {
        guard isUp else { return }
        if let answer = try? await api.me() { me = answer }
        await refreshSheet()
        await refreshBalance()
    }

    /// The sheet and, with it, what is wanted (the sheet's first group is drawn from the same list the badge counts).
    func refreshSheet() async {
        guard isUp else { return }
        if let answer = try? await api.sheet() {
            sheet = answer
            sheetMissing = answer == nil
        }
        if sheet?.state == "connected", let items = try? await api.attention() { attention = items } else if sheet?.state != "connected" { attention = [] }
        if sheet?.state == "connected" { await refreshAway() }
    }

    /// The run while away as the node sees it: whether it is scheduled, which agent is here, the cap, and the week's counts.
    func refreshAway() async {
        guard isUp else { return }
        if let answer = try? await api.away() { away = answer }
    }

    /// The standing and the coin, with every rise of the balance added to what was gained since the app opened.
    func refreshBalance() async {
        guard isUp, sheet?.state == "connected", let answer = try? await api.standing() else { return }
        standing = answer
        if let balance = answer.coin?.balance {
            if let last = lastBalance, balance > last {
                gained += balance - last
                risenAt = Date()
            }
            lastBalance = balance
        }
    }

    /// The balance is asked every fifteen seconds while the popover is open and every minute while it is closed.
    func watchBalance(open: Bool) {
        balanceTimer?.invalidate()
        balanceTimer = Timer.scheduledTimer(withTimeInterval: open ? 15 : 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refreshBalance() }
        }
        if open { Task { await refreshBalance() } }
    }

    /// Stops a node this app started; a node it attached to is left running.
    func stop() {
        guard let child, child.isRunning else { return }
        child.terminationHandler = nil
        child.terminate()
        self.child = nil
    }

    // MARK: The two acts

    /// `quilt init` for a home with no key: the phrase it prints is kept for the popover to show once, and the node this app
    /// started is started again so it signs with the new key; a node this app attached to is told about.
    /// A new key on this Mac: `quilt init`, the twelve words kept for the popover to show once.
    func makeKey() async {
        await runInit(["init"], failing: "no key could be made")
    }

    /// The key of an address on a tracker brought home: `quilt init --from <address>` fetches it once; the address is spent from then.
    func importAddress(_ address: String) async {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") else {
            keyNote = "That is not an address: it begins with https:// and ends in /mcp/ and a long code."
            return
        }
        await runInit(["init", "--from", trimmed], failing: "the key could not be brought home")
    }

    private func runInit(_ arguments: [String], failing: String) async {
        keyNote = nil
        guard let executable = Node.executable() else {
            keyNote = "The quilt executable was not found, so \(failing)."
            return
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["QUILT_HOME"] = home.path
        process.environment = environment
        let out = Pipe()
        process.standardOutput = out
        process.standardError = out
        do {
            try process.run()
        } catch {
            keyNote = "quilt init could not be run: \(error.localizedDescription)"
            return
        }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let text = String(decoding: data, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            keyNote = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return
        }
        // The phrase is on the line after "Phrase (shown once …):", indented; a key brought home has none to show.
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        if let i = lines.firstIndex(where: { $0.hasPrefix("Phrase") }), i + 1 < lines.count { newPhrase = lines[i + 1] }
        if lines.contains(where: { $0.hasPrefix("The key came home") }) { keyNote = "The key is home, with the standing and coin it earned. The address on the tracker is spent." }
        if child?.isRunning == true {
            stop()
            await startNode()
        } else {
            keyNote = "The key is made. The node running here was started by something else and still signs with no key; start it again to sign with this one."
            await refresh()
        }
    }

    /// The phrase has been written down: it is shown no more.
    func forgetPhrase() {
        newPhrase = nil
    }

    /// Hands the connector bundle to Claude Desktop, which installs it with no restart and no config file; what happened is kept for the popover.
    func installConnector() async {
        installNote = nil
        claudeMissing = false
        guard let bundle = Node.bundle() else {
            installNote = "The connector bundle quilt.mcpb is not in this app, so Claude Desktop cannot be handed it. The README beside the executable says how to add the connector by hand."
            return
        }
        guard let claude = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Node.claudeBundleId) else {
            claudeMissing = true
            return
        }
        do {
            try await NSWorkspace.shared.open([bundle], withApplicationAt: claude, configuration: NSWorkspace.OpenConfiguration())
            bundleOpened = true
        } catch {
            installNote = "Claude Desktop could not be opened with the bundle: \(error.localizedDescription)"
        }
        await refreshSheet()
    }

    /// The switch and the cap (POST /api/away): the node writes or removes the launchd agent for its own program; what it said is kept for the popover.
    func setAway(on: Bool, cap: Int) async {
        awayNote = nil
        do {
            let answer = try await api.setAway(on: on, cap: cap)
            away = answer
            awayNote = answer.note
        } catch {
            awayNote = error.localizedDescription
        }
    }

    /// Claude Desktop's bundle identifier, for handing it the connector bundle.
    static let claudeBundleId = "com.anthropic.claudefordesktop"

    /// The connector bundle: in the app, else, in development, at dist/quilt.mcpb above it.
    static func bundle() -> URL? {
        var candidates: [URL] = []
        if let resources = Bundle.main.resourceURL { candidates.append(resources.appendingPathComponent("quilt.mcpb")) }
        if let executable = Bundle.main.executableURL {
            var directory = executable.deletingLastPathComponent()
            while directory.path.count > 1 {
                candidates.append(directory.appendingPathComponent("dist/quilt.mcpb"))
                directory.deleteLastPathComponent()
            }
        }
        return candidates.first { FileManager.default.isReadableFile(atPath: $0.path) }
    }

    private func startNode() async {
        guard !startingNow else { return }
        startingNow = true
        defer { startingNow = false }
        status = .starting
        guard let executable = Node.executable() else {
            status = .failed("The quilt executable was not found: not in the app, not at QUILT_BIN, not at /usr/local/bin/quilt.")
            return
        }
        do {
            try launch(executable)
        } catch {
            status = .failed("The node could not be started: \(error.localizedDescription)")
            return
        }
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            try? await Task.sleep(nanoseconds: 500_000_000)
            if await api.answers() {
                status = .started
                await refresh()
                return
            }
            if child?.isRunning != true { break }
        }
        if case .failed = status { return }
        status = .failed("The node did not answer on port \(port) within fifteen seconds. Its log is at \(logURL.path).")
    }

    private func launch(_ executable: URL) throws {
        let files = FileManager.default
        try files.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !files.fileExists(atPath: logURL.path) { _ = files.createFile(atPath: logURL.path, contents: nil) }
        let log = try FileHandle(forWritingTo: logURL)
        _ = try log.seekToEnd()
        let stamp = ISO8601DateFormatter().string(from: Date())
        try log.write(contentsOf: Data("[\(stamp)] Quilt starts \(executable.path) serve --port \(port), QUILT_HOME=\(home.path)\n".utf8))
        let process = Process()
        process.executableURL = executable
        process.arguments = ["serve", "--port", String(port)]
        var environment = ProcessInfo.processInfo.environment
        environment["QUILT_HOME"] = home.path
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = log
        process.standardError = log
        process.terminationHandler = { [weak self] ended in
            Task { @MainActor in
                guard let self, self.child === ended else { return }
                self.child = nil
                if self.status == .started || self.status == .starting {
                    self.status = .failed("The node stopped with status \(ended.terminationStatus). Its log is at \(self.logURL.path).")
                }
            }
        }
        try process.run()
        child = process
    }

    // MARK: Where things are

    /// $QUILT_HOME, else $XDG_CONFIG_HOME/quilt, else ~/.config/quilt: the node's own rule.
    static func quiltHome() -> URL {
        let environment = ProcessInfo.processInfo.environment
        if let set = environment["QUILT_HOME"], !set.isEmpty {
            return URL(fileURLWithPath: NSString(string: set).expandingTildeInPath)
        }
        let config = environment["XDG_CONFIG_HOME"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config")
        return config.appendingPathComponent("quilt")
    }

    /// The port in config.json; 3978 when the file or the key is absent.
    static func port(home: URL) -> Int {
        guard let data = try? Data(contentsOf: home.appendingPathComponent("config.json")),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = config["port"] as? Int, port > 0, port < 65536 else { return 3978 }
        return port
    }

    /// The quilt executable: in the app, at QUILT_BIN, at /usr/local/bin, or, in development, a dist/bin above the executable.
    static func executable() -> URL? {
        var candidates: [URL] = []
        if let resources = Bundle.main.resourceURL { candidates.append(resources.appendingPathComponent("quilt")) }
        if let set = ProcessInfo.processInfo.environment["QUILT_BIN"], !set.isEmpty { candidates.append(URL(fileURLWithPath: set)) }
        candidates.append(URL(fileURLWithPath: "/usr/local/bin/quilt"))
        if let executable = Bundle.main.executableURL {
            var directory = executable.deletingLastPathComponent()
            while directory.path.count > 1 {
                candidates.append(directory.appendingPathComponent("dist/bin/quilt-darwin-arm64"))
                directory.deleteLastPathComponent()
            }
        }
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }
}
