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

    /// The record counts the answers, the ones another AI matched and the ones another AI disagreed with, and says
    /// so where the tracker gave as many readings as it gives. The picture a person shares says the same in a line,
    /// and is drawn at one size.
    @MainActor
    func testTheRecordCountsAnswersAndMatchesAndThePictureSaysThem() throws {
        let some = try work(readings: [
            reading("1", state: "accepted", beside: openai), reading("2", state: "accepted_provisional", beside: openai),
            reading("3", state: "disputed", beside: openai), reading("4", state: "needs_verify"), reading("5", state: "recorded"),
        ])
        XCTAssertEqual(some.tally.answers, 5)
        XCTAssertEqual(some.tally.matched, 2)
        XCTAssertEqual(some.tally.disagreed, 1)
        XCTAssertFalse(some.tally.more)
        XCTAssertEqual(QuiltPicture(work: some, score: "3").line, "5 answers \u{00B7} 2 matched by another AI")
        let one = try work(readings: [reading("1", state: "needs_verify")])
        XCTAssertEqual(QuiltPicture(work: one, score: "1").line, "1 answer")
        let many = try work(readings: (0 ..< Work.most).map { reading(String($0 % 10), state: "needs_verify") })
        XCTAssertTrue(many.tally.more)
        XCTAssertEqual(QuiltPicture(work: many, score: "1").line, "\(Work.most)+ answers")
        let picture = try XCTUnwrap(QuiltPicture(work: some, score: "3").image())
        XCTAssertEqual(picture.size, CGSize(width: 360, height: 450))
        XCTAssertEqual(picture.scale, 3)
    }

    /// A ping is said for an answer, a match, a disagreement and a draft that waits, in the banner's own words, with
    /// how many more things changed; a piece taken and an ask picked up are not worth one. News of an answer names
    /// the answer, so a tap opens it.
    func testAPingSaysWhatTheBannerWouldAndOnlyForWhatIsWorthOne() throws {
        let before = try work(readings: [reading("1", state: "needs_verify")])
        let after = try work(readings: [reading("1", state: "accepted_provisional", beside: openai), reading("2", state: "needs_verify")], working: held)
        let seen = Dictionary(uniqueKeysWithValues: before.readings.map { ($0.key, String(describing: $0.standing)) })
        let news = after.news(since: seen, held: [])
        XCTAssertEqual(news.map(\.kind), [.agreed, .returned, .took])
        XCTAssertEqual(news.map(\.reading), ["sha256:r1", "sha256:r2", nil])
        let matched = try XCTUnwrap(Pings.words(for: news[0], more: 1))
        XCTAssertEqual(matched.title, "Another AI matched your Claude")
        XCTAssertEqual(matched.body, "Claim 1. Matched by an AI from OpenAI. And 1 more.")
        XCTAssertEqual(Pings.words(for: news[1])?.title, "Your Claude answered")
        XCTAssertNil(Pings.words(for: news[2]))
        XCTAssertNil(Pings.words(for: News(kind: .sent, title: "Your Claude picked it up", body: "", state: "in_flight")))
        XCTAssertNotNil(Pings.words(for: News(kind: .asked, title: "Your Claude drafted a problem", body: "", state: "open")))
        XCTAssertNotNil(Pings.words(for: News(kind: .differs, title: "Another AI disagreed", body: "", state: "disputed")))
    }

    func testAReadingIsReadWithItsReturnAndWhatItRestsOn() throws {
        let r = try work(readings: [reading("1", state: "needs_verify")]).readings[0]
        XCTAssertEqual(r.key, "sha256:r1")
        // A return of more than three fields has no one answer, so a row says how many it answered.
        XCTAssertEqual(r.said, "5 fields answered")
        XCTAssertEqual(r.fields.map(\.name), ["pages", "sure", "verdict", "note", "quote"])
        XCTAssertEqual(r.fields.map(\.value), ["3", "yes", "supports", "left blank", "in so many words"])
        XCTAssertEqual(r.rests, [Work.Rest(field: "quote", url: "https://paper.example/one", passage: "in so many words")])
        XCTAssertEqual(r.standing, .onRecord)
        XCTAssertEqual(r.story, "Recorded. First answer on this piece.")
    }

    func testAShortReturnSaysItsVerdictAndNotANumberBesideIt() throws {
        let json = #"{"address":"0xA","root":"0xB","working":[],"readings":[{"problem":"sha256:p","title":"T","piece":"sha256:1","name":"claim/1","at":"2026-11-15T12:00:00.000Z","state":"needs_verify","id":"sha256:r","vendor":"anthropic","counts":"counted","why":null,"return":{"verdict":"supports","pages":3,"quote":"in so many words"},"rests":[],"beside":[]}]}"#
        let r = try JSONDecoder().decode(Work.self, from: Data(json.utf8)).readings[0]
        XCTAssertEqual(r.said, "Supports")
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
        XCTAssertEqual(w.readings[0].story, "Matched by an AI from OpenAI.")
        XCTAssertEqual(w.readings[1].story, "Matched by an AI from OpenAI. Final.")
        XCTAssertEqual(w.readings[2].story, "Another AI disagreed. Both answers are kept.")
        XCTAssertEqual(w.readings[3].story, "Kept, and not counted: it gives no source where another answer does.")
        XCTAssertEqual(w.readings[4].story, "Kept, and not counted here: the piece was matched before it came.")
        XCTAssertEqual(w.readings[5].story, "Struck, and not counted: a challenge against its match held.")
        XCTAssertEqual(w.readings[6].story, "Recorded, with 1 other answer.")
    }

    func testVendorsAreNamedAsAPersonKnowsThem() {
        XCTAssertEqual(Vendor.list(["OpenAI"]), "An AI from OpenAI")
        XCTAssertEqual(Vendor.list(["OpenAI", "Google", "OpenAI"]), "AIs from OpenAI and Google")
        XCTAssertEqual(Vendor.by(["OpenAI"]), "an AI from OpenAI")
        XCTAssertEqual(Vendor.by([]), "another AI")
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
        XCTAssertEqual(first[0].body, "Claim 1: 5 fields answered. Recorded. First answer on this piece.")
        // Nothing new at the next look.
        XCTAssertEqual(back.news(since: stand(back), held: []).map(\.kind), [])
        // Another AI reads it the same, and another piece is taken: the agreement leads.
        let agreed = try work(readings: [reading("1", state: "accepted_provisional", beside: openai)], working: held)
        let then = agreed.news(since: stand(back), held: [])
        XCTAssertEqual(then.map(\.kind), [.agreed, .took])
        XCTAssertEqual(then[0].title, "Another AI matched your Claude")
        // A reading that differs is said as one.
        let differs = try work(readings: [reading("1", state: "disputed", beside: openai)])
        XCTAssertEqual(differs.news(since: stand(back), held: []).map(\.kind), [.differs])
    }
}

/// The app's own words (Sources/Words.swift): a piece's name and state as a person reads them, a state said as what
/// happened and never as the rule the piece is held to, the tracker's reasons in plain words, and a problem's count.
final class WordsTests: XCTestCase {
    func testAPieceAndAFieldAreNamedAsAPersonReadsThem() {
        XCTAssertEqual(Plain.piece("claim/5"), "Claim 5")
        XCTAssertEqual(Plain.piece("seed"), "Seed")
        XCTAssertEqual(Plain.field("page_count"), "Page count")
        XCTAssertEqual(Plain.value("supports"), "Supports")
        // A quote is somebody's words, and is left as it was given.
        XCTAssertEqual(Plain.value("in so many words"), "in so many words")
    }

    func testEveryStateTheMapDrawsHasAWordAndASentence() {
        for state in ["open", "in_flight", "needs_verify", "accepted_provisional", "accepted", "disputed", "challenged", "recording", "recorded", "judging"] {
            XCTAssertFalse(Plain.state(state).contains("_"), state)
            XCTAssertTrue(Plain.explain(state).hasSuffix("."), state)
        }
        XCTAssertEqual(Plain.state("disputed"), "Disagreed")
        // What happened on a disputed piece, and not the rule that would have matched it.
        XCTAssertEqual(Plain.explain("disputed"), "Disagreed. AIs gave different answers, and every one is kept.")
        XCTAssertFalse(Plain.explain("disputed").contains("agree."))
        // An answer with no match is said as answered, and nothing says that it waits.
        for state in ["needs_verify", "recording"] { XCTAssertFalse(Plain.explain(state).lowercased().contains("wait"), state) }
    }

    func testAReasonIsSaidPlainlyAndAnUnknownOneAsTheTrackerWroteIt() {
        XCTAssertEqual(Plain.reason("the set holds a reading from its vendor"), "the match already has an AI from the same company")
        XCTAssertEqual(Plain.reason("a reason of a later tracker"), "a reason of a later tracker")
        XCTAssertEqual(Plain.reason(nil), "a decision went against it")
    }

    func testAProblemIsCountedInOneLine() {
        XCTAssertEqual(Plain.progress(pieces: 12, counts: ["open": 7, "needs_verify": 3, "disputed": 1, "accepted_provisional": 1]),
                       "12 pieces \u{00B7} 4 answered \u{00B7} 1 matched")
        XCTAssertEqual(Plain.progress(pieces: 1, counts: ["open": 1]), "1 piece")
    }

    func testASentenceOfTheSheetsIsNamedAsAButtonAndAnUnknownOneAsTheSheetWroteIt() throws {
        let phrase = { (name: String) in
            try JSONDecoder().decode(Phrase.self, from: Data(#"{"name":"\#(name)","title":"The sheet's title","say":"Say it.","about":"The AI does it."}"#.utf8))
        }
        XCTAssertEqual(Plain.ask(try phrase("how_it_works")).title, "Explain Quilt to me")
        XCTAssertEqual(Plain.ask(try phrase("find_something_to_do")).about, "Your Claude picks a piece that needs an answer.")
        XCTAssertEqual(Plain.ask(try phrase("a_later_phrase")).title, "The sheet's title")
        XCTAssertEqual(Plain.group("Wanted from you"), "Needs a look")
    }

    /// A problem's row draws every piece where the problem is small, and the same proportions where it is not, the
    /// furthest along first; a state with any piece in it keeps a square.
    func testAProblemsStripDrawsItsPiecesInProportion() {
        let small = QuiltStrip(pieces: 6, counts: ["open": 4, "needs_verify": 1, "in_flight": 1]).patches
        XCTAssertEqual(small, ["needs_verify", "in_flight", "open", "open", "open", "open"])
        let all = QuiltStrip(pieces: 4, counts: ["accepted": 1, "accepted_provisional": 1, "disputed": 1, "needs_verify": 1]).patches
        XCTAssertEqual(all, ["accepted", "accepted_provisional", "disputed", "needs_verify"])
        // A large problem is drawn in thirty-six squares, and its one disagreement still has a square.
        let large = QuiltStrip(pieces: 900, counts: ["open": 849, "accepted": 50, "disputed": 1]).patches
        XCTAssertEqual(large.count, 36)
        XCTAssertEqual(large.filter { $0 == "accepted" }.count, 2)
        XCTAssertEqual(large.filter { $0 == "disputed" }.count, 1)
        XCTAssertEqual(large.last, "open")
        // A finished one is all final.
        XCTAssertEqual(Set(QuiltStrip(pieces: 3, counts: ["accepted": 3]).patches), ["accepted"])
    }

    func testProblemsWithWorkUnderWayComeFirst() throws {
        let problem = { (hash: String, counts: String, complete: Bool) in
            try JSONDecoder().decode(Problem.self, from: Data(#"{"problem":"\#(hash)","title":"T","done_when":"D","pieces":2,"counts":\#(counts),"complete":\#(complete)}"#.utf8))
        }
        let listed = [
            try problem("untouched", #"{"open":2}"#, false), try problem("done", #"{"accepted":2}"#, true),
            try problem("busy", #"{"open":1,"needs_verify":1}"#, false), try problem("fresh", #"{"open":2}"#, false),
        ]
        XCTAssertEqual(ProblemsView.busyFirst(listed).map(\.problem), ["busy", "untouched", "fresh", "done"])
    }

    func testASentenceIsShownWithTheProblemsTitleWhereItsLinkIs() {
        let link = "quilt:sha256:" + String(repeating: "a", count: 64) + "?dn=seeds&tr=http%3A%2F%2Ft.test%2F"
        let sent = HandOff(title: "Send my Claude", sentence: "Open \(link) on Quilt and take a piece.", phrase: "take_piece", named: "Which seeds wake?")
        XCTAssertEqual(sent.shown, "Open \u{201C}Which seeds wake?\u{201D} on Quilt and take a piece.")
        // What is sent is the sentence with its link, unchanged.
        XCTAssertTrue(sent.sentence.contains(link))
        XCTAssertEqual(HandOff(title: "T", sentence: "Open \(link) on Quilt.").shown, "Open this problem on Quilt.")
        XCTAssertEqual(HandOff(title: "T", sentence: "Find me something to do on Quilt.").shown, "Find me something to do on Quilt.")
    }
}
