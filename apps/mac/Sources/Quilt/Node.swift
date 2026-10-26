// Node.swift: owning or attaching to the node. On launch the shell reads the port from $QUILT_HOME/config.json, asks
// /api/me, attaches when a node answers and otherwise starts one as a child with its output in
// ~/Library/Logs/Quilt/node.log. Every thirty seconds it asks again, and starts a node when the one it had is gone.
// Quitting stops only a node this app started. The views read this object; nothing here signs or writes anything.

import AppKit
import Foundation

@MainActor
final class Node: ObservableObject {
    enum Status: Equatable {
        case probing, starting, attached, started
        case failed(String)
    }

    /// A problem from the library as the popover lists it.
    struct Entry: Identifiable {
        let hash: String
        let title: String
        var id: String { hash }
    }

    @Published private(set) var status: Status = .probing
    @Published private(set) var me: Me?
    @Published private(set) var library: Library?
    @Published private(set) var attention: [AttentionItem] = []

    let home: URL
    let port: Int
    let api: API
    let logURL: URL
    private var child: Process?
    private var startingNow = false
    private var timers: [Timer] = []

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
                Task { @MainActor in await self?.refreshAttention() }
            },
        ]
        Task { await connect() }
    }

    // MARK: What the views read

    var isUp: Bool { status == .attached || status == .started }

    var statusText: String {
        switch status {
        case .probing: return "looking for the node"
        case .starting: return "starting the node"
        case .attached: return "attached to a node already running"
        case .started: return "node started by Quilt"
        case .failed(let why): return why
        }
    }

    /// The name the person chose, else the start of their address, else that there is no key yet.
    var who: String {
        if let name = me?.name, !name.isEmpty { return name }
        if let address = me?.address { return String(address.prefix(10)) }
        return me == nil ? "" : "no key yet"
    }

    /// The problems the person keeps, newest first by when they began keeping them.
    var keeping: [Entry] {
        guard let library else { return [] }
        return (library.seeding ?? [:]).sorted { $0.value > $1.value }
            .compactMap { hash, _ in library.problems[hash].map { Entry(hash: hash, title: $0.title) } }
    }

    /// Up to eight other problems from the library, by when they were last touched.
    var openedLately: [Entry] {
        guard let library else { return [] }
        let kept = library.seeding ?? [:]
        return library.problems.filter { kept[$0.key] == nil }.sorted { $0.value.last > $1.value.last }
            .prefix(8).map { Entry(hash: $0.key, title: $0.value.title) }
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
        if let answer = try? await api.library() { library = answer }
        await refreshAttention()
    }

    func refreshAttention() async {
        guard isUp, let items = try? await api.attention() else { return }
        attention = items
    }

    /// Stops a node this app started; a node it attached to is left running.
    func stop() {
        guard let child, child.isRunning else { return }
        child.terminationHandler = nil
        child.terminate()
        self.child = nil
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
