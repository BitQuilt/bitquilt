// A key's work as the tracker answers it at /k/<address>/work (Sources/Work.swift): the answer read, each reading's
// standing and sentence, and what the phone says changed between one look and the next.
import XCTest
@testable import Quilt

final class WorkTests: XCTestCase {
    /// One reading as the tracker writes it, with the state, how it counts and the readings beside it given.
    private func reading(_ id: String, state: String, counts: String = "counted", why: String? = nil, beside: String = "[]") -> String {
        """
        {"problem":"sha256:p","title":"Statements","piece":"sha256:\(id)","name":"claim/\(id)","at":"2026-11-15T12:00:0\(id).000Z",
         "state":"\(state)","aside":false,"verified":false,"traced":"one","id":"sha256:r\(id)","vendor":"anthropic",
         "counts":"\(counts)","why":\(why.map { "\"\($0)\"" } ?? "null"),
         "return":{"verdict":"supports","quote":"in so many words","pages":3,"sure":true,"note":null},
         "rests":[{"field":"quote","url":"https://paper.example/one","passage":"in so many words"}],"beside":\(beside)}
        """
    }

    private func work(readings: [String], working: String = "[]") throws -> Work {
        let json = #"{"address":"0xA","root":"0xB","name":null,"standing":1,"working":\#(working),"readings":[\#(readings.joined(separator: ","))],"at":"2026-11-15T12:00:09.000Z"}"#
        return try JSONDecoder().decode(Work.self, from: Data(json.utf8))
    }

    private let openai = #"[{"vendor":"openai","counts":"counted","why":null}]"#
    private let held = #"[{"problem":"sha256:p","title":"Statements","piece":"sha256:9","name":"claim/9","at":"2026-11-15T12:00:00.000Z","until":"2026-11-15T14:00:00.000Z"}]"#

    func testAReadingIsReadWithItsReturnAndWhatItRestsOn() throws {
        let r = try work(readings: [reading("1", state: "needs_verify")]).readings[0]
        XCTAssertEqual(r.key, "sha256:r1")
        // A return of more than three fields has no one answer, so a row says how many it answered.
        XCTAssertEqual(r.said, "It answered 5 fields.")
        XCTAssertEqual(r.fields.map(\.name), ["pages", "sure", "verdict", "note", "quote"])
        XCTAssertEqual(r.fields.map(\.value), ["3", "yes", "supports", "left blank", "in so many words"])
        XCTAssertEqual(r.rests, [Work.Rest(field: "quote", url: "https://paper.example/one", passage: "in so many words")])
        XCTAssertEqual(r.standing, .onRecord)
        XCTAssertEqual(r.story, "On the record under your key. It is the first reading of this piece.")
    }

    func testAShortReturnSaysItsVerdictAndNotANumberBesideIt() throws {
        let json = #"{"address":"0xA","root":"0xB","working":[],"readings":[{"problem":"sha256:p","title":"T","piece":"sha256:1","name":"claim/1","at":"2026-11-15T12:00:00.000Z","state":"needs_verify","id":"sha256:r","vendor":"anthropic","counts":"counted","why":null,"return":{"verdict":"supports","pages":3,"quote":"in so many words"},"rests":[],"beside":[]}]}"#
        let r = try JSONDecoder().decode(Work.self, from: Data(json.utf8)).readings[0]
        XCTAssertEqual(r.said, "It said: supports.")
    }

    func testEachStandingHasItsSentence() throws {
        let w = try work(readings: [
            reading("1", state: "accepted_provisional", beside: openai),
            reading("2", state: "accepted", beside: openai),
            reading("3", state: "disputed", beside: openai),
            reading("4", state: "needs_verify", counts: "aside", why: "it rests on nothing where another reading rests on the record"),
            reading("5", state: "accepted", counts: "kept", why: "the set was made before it"),
            reading("6", state: "open", counts: "struck", why: "a challenge held against its set"),
            reading("7", state: "recorded", beside: openai),
        ])
        XCTAssertEqual(w.readings.map(\.standing), [.agreed, .agreed, .differs, .aside, .kept, .struck, .recorded])
        XCTAssertEqual(w.readings[0].story, "An AI from OpenAI gave the same answer. The square is green, and open to challenge for a while.")
        XCTAssertEqual(w.readings[1].story, "An AI from OpenAI gave the same answer. The square is settled.")
        XCTAssertEqual(w.readings[2].story, "Another AI read it differently. Both readings are kept, each under its own key, and the piece goes out for a third.")
        XCTAssertEqual(w.readings[3].story, "Set aside: it rests on nothing where another reading rests on the record. It stays on the record.")
        XCTAssertEqual(w.readings[4].story, "Kept on the record, and it counts for nothing on this piece: the set was made before it.")
        XCTAssertEqual(w.readings[5].story, "This reading was struck: a challenge held against its set.")
        XCTAssertEqual(w.readings[6].story, "Recorded beside 1 other reading. Every one is kept.")
    }

    func testVendorsAreNamedAsAPersonKnowsThem() {
        XCTAssertEqual(Vendor.list(["OpenAI"]), "An AI from OpenAI")
        XCTAssertEqual(Vendor.list(["OpenAI", "Google", "OpenAI"]), "AIs from OpenAI and Google")
        XCTAssertEqual(Vendor.name("mistral"), "Mistral")
        XCTAssertEqual(Vendor.name("cohere"), "Cohere")
    }

    func testNewsIsWhatChangedSinceTheLastLook() throws {
        let stand = { (w: Work) in Dictionary(uniqueKeysWithValues: w.readings.map { ($0.key, String(describing: $0.standing)) }) }
        // A piece taken, with nothing seen before.
        let taken = try work(readings: [], working: held)
        XCTAssertEqual(taken.news(since: [:], held: []).map(\.kind), [.took])
        XCTAssertEqual(taken.news(since: [:], held: ["sha256:9"]).map(\.kind), [])
        // Its answer handed back.
        let back = try work(readings: [reading("1", state: "needs_verify")])
        let first = back.news(since: [:], held: [])
        XCTAssertEqual(first.map(\.kind), [.returned])
        XCTAssertEqual(first[0].body, "claim/1. It answered 5 fields. On the record under your key. It is the first reading of this piece.")
        // Nothing new at the next look.
        XCTAssertEqual(back.news(since: stand(back), held: []).map(\.kind), [])
        // Another AI reads it the same, and another piece is taken: the agreement leads.
        let agreed = try work(readings: [reading("1", state: "accepted_provisional", beside: openai)], working: held)
        let then = agreed.news(since: stand(back), held: [])
        XCTAssertEqual(then.map(\.kind), [.agreed, .took])
        XCTAssertEqual(then[0].title, "Another AI read it the same")
        // A reading that differs is said as one.
        let differs = try work(readings: [reading("1", state: "disputed", beside: openai)])
        XCTAssertEqual(differs.news(since: stand(back), held: []).map(\.kind), [.differs])
    }
}
