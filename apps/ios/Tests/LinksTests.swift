// The links that open the app (Sources/Links.swift): a square's page on this app's tracker and a problem's own link
// are read, nothing else is, and a link puts what it names in front, past the welcome.
import XCTest
@testable import Quilt

final class LinksTests: XCTestCase {
    private let problem = "sha256:" + String(repeating: "a", count: 64)
    private let piece = "sha256:" + String(repeating: "b", count: 64)
    private let tracker = URL(string: "https://tracker.bitquilt.org/")!

    private func opened(_ link: String) -> Opened? {
        URL(string: link).flatMap { Opened($0, tracker: tracker) }
    }

    func testASquaresPageAndAProblemsLinkAreReadAndNothingElseIs() {
        XCTAssertEqual(opened("https://tracker.bitquilt.org/r/\(problem)/\(piece)"), .square(problem: problem, piece: piece))
        // The colons written as a browser may write them.
        let escaped = "https://tracker.bitquilt.org/r/\(problem)/\(piece)".replacingOccurrences(of: "sha256:", with: "sha256%3A")
        XCTAssertEqual(opened(escaped), .square(problem: problem, piece: piece))
        XCTAssertEqual(opened("quilt:\(problem)?dn=white-paper&tr=https%3A%2F%2Ftracker.bitquilt.org%2F"), .problem(problem))
        XCTAssertEqual(opened("quilt:\(problem)"), .problem(problem))
        for other in [
            "https://example.org/r/\(problem)/\(piece)",
            "https://tracker.bitquilt.org/r/\(problem)",
            "https://tracker.bitquilt.org/r/\(problem)/\(piece)/more",
            "https://tracker.bitquilt.org/p/\(problem)/\(piece)",
            "https://tracker.bitquilt.org/r/\(problem)/sha256:short",
            "https://tracker.bitquilt.org/",
            "quilt:nothing",
            "quilt:\(problem)extra",
            "claude://",
        ] {
            XCTAssertNil(opened(other), other)
        }
    }

    /// A problem's link puts the Problems page in front with the problem named, and a person who has not set up sees
    /// it and not the welcome. A link this app does not follow changes nothing.
    @MainActor
    func testALinkPutsWhatItNamesInFrontPastTheWelcome() async {
        let store = Store()
        store.forget()
        store.tab = "home"
        XCTAssertTrue(store.welcoming)
        let followed = await store.follow(URL(string: "claude://")!)
        XCTAssertFalse(followed)
        XCTAssertTrue(store.welcoming)
        XCTAssertNil(store.visit)
        let named = await store.follow(URL(string: "quilt:\(problem)?dn=white-paper")!)
        XCTAssertTrue(named)
        XCTAssertFalse(store.welcoming)
        XCTAssertEqual(store.tab, "problems")
        XCTAssertEqual(store.visit, Visit(problem: problem, piece: nil))
    }
}
