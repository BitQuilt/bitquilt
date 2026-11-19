// What the phone keeps of its last read (Sources/Kept.swift): a person's work reads back as it was written, a sheet
// is kept without the private link its answer carries, one link's pages are not another's, and signing out removes
// them.
import XCTest
@testable import Quilt

final class KeptTests: XCTestCase {
    private let mine = "https://tracker.example/mcp/" + String(repeating: "a", count: 64)
    private let other = "https://tracker.example/mcp/" + String(repeating: "b", count: 64)

    override func setUp() {
        Kept.clear()
        Kept.settle()
    }

    override func tearDown() {
        Kept.clear()
        Kept.settle()
    }

    func testWorkReadsBackAsItWasWrittenAndOnlyUnderItsOwnLink() throws {
        let json = #"{"address":"0x1","root":"0x2","working":[{"problem":"sha256:p","title":"A problem","piece":"sha256:c","name":"claim/3","at":"2026-11-18T12:02:00.000Z","until":"2026-11-18T13:02:00.000Z"}],"readings":[{"problem":"sha256:p","title":"A problem","piece":"sha256:b","name":"claim/2","at":"2026-11-18T12:01:00.000Z","state":"accepted_provisional","id":"sha256:e2","vendor":"anthropic","counts":"counted","why":null,"return":{"verdict":"supports","pages":12,"share":0.25,"open":true,"tags":["a","b"],"more":{"k":null}},"rests":[{"field":"verdict","url":"https://a.example/","passage":"It says so."}],"beside":[{"vendor":"openai","counts":"counted","why":null}]}]}"#
        let work = try JSONDecoder().decode(Work.self, from: Data(json.utf8))
        Kept.write("work", work, for: mine)
        Kept.settle()
        XCTAssertEqual(Kept.read("work", for: mine, as: Work.self), work)
        XCTAssertNil(Kept.read("work", for: other, as: Work.self))
        XCTAssertNil(Kept.read("work", as: Work.self))
        // Nil removes it.
        Kept.write("work", Work?.none, for: mine)
        Kept.settle()
        XCTAssertNil(Kept.read("work", for: mine, as: Work.self))
    }

    /// The sheet's answer carries the private link. The app's model of a sheet does not hold it, so what is kept
    /// does not either, and neither does the file's name.
    func testASheetIsKeptWithoutThePrivateLink() throws {
        let json = #"{"state":"connected","address":"0xE6956f346781f452f9CD468eC8720005c5814c5b","url":"\#(mine)","backup":"\#(mine)/key","connector":{"first":"2026-11-18T12:00:00.000Z","last":"2026-11-18T12:05:00.000Z"},"first":{"name":"who_am_i","title":"Who am I","say":"Open Quilt and tell me who I am.","about":"The AI says."},"groups":[],"standing":{"standing":2,"root":"0xA0Bd66ff7C022fF47D6066fdDDcB01e504a8ABf6"}}"#
        let sheet = try JSONDecoder().decode(Sheet.self, from: Data(json.utf8))
        Kept.write("sheet", sheet, for: mine)
        Kept.settle()
        let kept = try XCTUnwrap(Kept.bytes("sheet", for: mine))
        let text = String(decoding: kept, as: UTF8.self)
        XCTAssertFalse(text.contains("/mcp/"))
        XCTAssertFalse(text.contains(String(repeating: "a", count: 64)))
        let back = try XCTUnwrap(Kept.read("sheet", for: mine, as: Sheet.self))
        XCTAssertTrue(back.connected)
        XCTAssertEqual(back.standing?.standing, 2)
    }

    func testSigningOutRemovesEverythingKept() {
        Kept.write("problems", ["a"])
        Kept.write("asks", ["b"], for: mine)
        Kept.settle()
        XCTAssertNotNil(Kept.read("problems", as: [String].self))
        Kept.clear()
        Kept.settle()
        XCTAssertNil(Kept.read("problems", as: [String].self))
        XCTAssertNil(Kept.read("asks", for: mine, as: [String].self))
    }
}
