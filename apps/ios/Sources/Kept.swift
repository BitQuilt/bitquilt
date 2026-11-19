// What the app last read, kept on this phone, so a page opens on what it last showed and is read again at once: the
// person's sheet, their Claude's work, what they sent to Claude, the list of problems and each map looked at. Each is
// written again from what the app read out of the tracker's answer, and not as the tracker's own bytes: the sheet's
// answer carries the private link, which is the keychain's alone, and the app's own model of a sheet does not hold
// it. The files are in the caches folder, which the phone may empty and no backup takes, under a name made from the
// tracker and the link, so one person's pages are never shown for another's. Signing out removes them.
import CryptoKit
import Foundation

enum Kept {
    /// The most maps kept: the oldest goes when another is written.
    private static let maps = 40
    /// Every write and removal goes through one queue, in the order it was asked for, off the main thread.
    private static let queue = DispatchQueue(label: "org.bitquilt.quilt.kept", qos: .utility)

    /// A short name that stands for the tracker and the private link without saying either.
    private static func mark(_ owner: String?) -> String {
        let named = Tracker.base.absoluteString + "\n" + (owner ?? "")
        return SHA256.hash(data: Data(named.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    private static var folder: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appending(path: "kept")
    }

    private static func file(_ name: String, _ owner: String?) -> URL? {
        folder?.appending(path: "\(mark(owner))-\(name.replacingOccurrences(of: ":", with: "-")).json")
    }

    /// What was last kept under a name, for the person whose link is `owner`, or for anyone where it is nil. Nil
    /// where nothing is kept or what is kept cannot be read as the app reads it now.
    static func read<T: Decodable>(_ name: String, for owner: String? = nil, as type: T.Type = T.self) -> T? {
        guard let file = file(name, owner), let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    /// Keeps a value under a name; nil removes what was kept. A file can be read once the phone has been unlocked
    /// since it started, so a look in the background can read it.
    static func write<T: Encodable>(_ name: String, _ value: T?, for owner: String? = nil) {
        guard let folder, let file = file(name, owner) else { return }
        let data = value.flatMap { try? JSONEncoder().encode($0) }
        let prune = name.hasPrefix("state-")
        queue.async {
            guard let data else {
                try? FileManager.default.removeItem(at: file)
                return
            }
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            if prune { Kept.prune(in: folder) }
        }
    }

    /// Removes everything kept, for every tracker and link.
    static func clear() {
        guard let folder else { return }
        queue.async { try? FileManager.default.removeItem(at: folder) }
    }

    /// Waits until everything asked for so far is written, for a test that reads the files.
    static func settle() { queue.sync {} }

    /// The bytes kept under a name, as they are on the phone, for a test of what is and is not written.
    static func bytes(_ name: String, for owner: String? = nil) -> Data? {
        file(name, owner).flatMap { try? Data(contentsOf: $0) }
    }

    /// Keeps the newest maps and removes the rest.
    private static func prune(in folder: URL) {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey]
        let all = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: Array(keys))) ?? []
        let states = all.filter { $0.lastPathComponent.contains("-state-") }
        guard states.count > maps else { return }
        let dated = states.map { ($0, (try? $0.resourceValues(forKeys: keys))?.contentModificationDate ?? .distantPast) }
        for (old, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(maps) { try? FileManager.default.removeItem(at: old) }
    }
}
