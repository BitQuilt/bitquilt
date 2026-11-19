// The links that open the app. A square's page on the tracker, https://<tracker>/r/<problem>/<piece>, opens here on
// that square where the phone has the app: the tracker's name is associated with the app (project.yml, and the file
// the host answers, docs/DEPLOY.md, The public door), so the page Claude names after an answer leads back to this
// app. A problem's own link, quilt:<hash>, opens the problem's page. A link is read as an address and nothing else: it
// names what to show, and nothing is signed, sent or asked because of it.
import Foundation

/// What a link names: one square of a problem, or a problem.
enum Opened: Equatable {
    case square(problem: String, piece: String)
    case problem(String)

    private static let hash = #"sha256:[0-9a-f]{64}"#

    /// Reads a link. Nil for anything that is not a square's page on this app's tracker or a problem's link.
    init?(_ url: URL, tracker: URL = Tracker.base) {
        let whole = { (s: String) in s.range(of: "^\(Opened.hash)$", options: .regularExpression) != nil }
        if url.scheme == "quilt" {
            // quilt:<hash>?dn=<name>&tr=<tracker>: the hash is the problem, and the rest says where it is held.
            let named = String(url.absoluteString.dropFirst("quilt:".count).prefix { $0 != "?" && $0 != "&" })
            guard whole(named) else { return nil }
            self = .problem(named)
            return
        }
        guard url.scheme == "https" || url.scheme == "http", url.host() == tracker.host() else { return nil }
        let parts = url.path().removingPercentEncoding?.split(separator: "/").map(String.init) ?? []
        guard parts.count >= 3, parts[parts.count - 3] == "r" else { return nil }
        let (problem, piece) = (parts[parts.count - 2], parts[parts.count - 1])
        guard whole(problem), whole(piece) else { return nil }
        self = .square(problem: problem, piece: piece)
    }
}

/// A problem the person asked to see by a link, and the square of it where the link named one, until the problem's
/// page has shown it.
struct Visit: Equatable {
    let problem: String
    let piece: String?
}
