// The store's own acts against a real door, as a tap would start them (Sources/Store.swift): a join that makes the
// root here and delegates to the new address at once, an address the tracker held as a root brought under a fresh
// root of this phone's by a rotation, and a problem drafted through the address published by the phone's key. They
// write this app's keychain, so they run in the simulator alone, and only where TEST_RUNNER_QUILT_TEST_TRACKER names
// an on-ramp that holds a problem, as DoorTests.swift says.
import XCTest
@testable import Quilt

@MainActor
final class StoreTests: XCTestCase {
    override func setUp() async throws {
        #if !targetEnvironment(simulator)
            throw XCTSkip("the store's tests write the keychain, so they run in the simulator alone")
        #else
            guard let tracker = ProcessInfo.processInfo.environment["QUILT_TEST_TRACKER"], !tracker.isEmpty else {
                throw XCTSkip("no on-ramp named in QUILT_TEST_TRACKER")
            }
            UserDefaults.standard.set(tracker, forKey: "tracker")
            UserDefaults.standard.set("no", forKey: "presence")
            for name in ["seen", "held", "fresh", "asked"] { UserDefaults.standard.removeObject(forKey: name) }
            UserDefaults.standard.removeObject(forKey: "address")
            Keychain.delete()
            RootStore.delete()
        #endif
    }

    override func tearDown() async throws {
        UserDefaults.standard.removeObject(forKey: "tracker")
        UserDefaults.standard.removeObject(forKey: "presence")
    }

    func testAnAddressTheTrackerHeldComesUnderAFreshRootByARotation() async throws {
        // An address made elsewhere, whose key has signed: a name, through the tools over plain HTTP.
        let joined = try await Tracker.join()
        var named = URLRequest(url: URL(string: joined.url + "/tools/quilt_name")!)
        named.httpMethod = "POST"
        named.setValue("application/json", forHTTPHeaderField: "content-type")
        named.httpBody = Data(#"{"model":"anthropic/claude-test","input":{"name":"Held At The Tracker"}}"#.utf8)
        let (_, answered) = try await URLSession.shared.data(for: named)
        XCTAssertEqual((answered as? HTTPURLResponse)?.statusCode, 200)

        let store = Store()
        XCTAssertNil(store.root)
        await store.use(joined.url)
        XCTAssertNil(store.problem)
        XCTAssertFalse(store.phoneHoldsRoot)
        await store.bringHome()
        XCTAssertNil(store.problem)
        XCTAssertTrue(store.phoneHoldsRoot)
        XCTAssertEqual(store.root?.took, joined.address)
        XCTAssertEqual(RootStore.read(), store.root)
        // Sent again, as after a lost answer, it is the same rotation and stands as it did.
        await store.bringHome()
        XCTAssertNil(store.problem)
        XCTAssertTrue(store.phoneHoldsRoot)
    }

    func testAJoinMakesTheRootHereAndTheTrackersKeySignsForIt() async throws {
        let store = Store()
        await store.join()
        XCTAssertNil(store.problem)
        let root = try XCTUnwrap(store.root?.key)
        XCTAssertTrue(store.phoneHoldsRoot)
        XCTAssertEqual(store.sheet?.standing?.root, root.address)
        XCTAssertNotEqual(store.sheet?.address, root.address)
        XCTAssertEqual(store.root?.signed, true)
        // A second store, as after a relaunch, reads the same root and the same address.
        let again = Store()
        XCTAssertEqual(again.root, store.root)
        XCTAssertEqual(again.address, store.address)
    }

    /// One tool called at an address over plain HTTP, as an AI with no MCP client calls it; the answer's text.
    private func call(_ url: String, _ tool: String, _ input: String) async throws -> String {
        var request = URLRequest(url: URL(string: url + "/tools/" + tool)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = Data(#"{"model":"anthropic/claude-test","input":\#(input)}"#.utf8)
        let (data, _) = try await URLSession.shared.data(for: request)
        return String(decoding: data, as: UTF8.self)
    }

    private func pattern(_ slug: String) -> String {
        #"{"pattern":{"title":"Which of these does the Declaration say? (\#(slug))","done_when":"Every sentence has been read by two AIs from different companies.","slug":"\#(slug)","topics":["rights"],"pieces":{"sentence/*":{"verifier":"agree","count":2,"data":{"row":"rows"},"brief":"Does the Universal Declaration of Human Rights say this: {row.claim} Quote the words it rests on.","schema":{"type":"object","additionalProperties":false,"required":["verdict"],"properties":{"verdict":{"enum":["supports","contradicts"]}}},"agree":["verdict"]}},"data":{"rows":[{"claim":"All are equal before the law."},{"claim":"No one shall be held in slavery."}]}}}"#
    }

    func testAProblemClaudeDraftsWaitsForThisPhonesKeyAndIsPublishedByIt() async throws {
        let store = Store()
        await store.join()
        XCTAssertTrue(store.phoneHoldsRoot)
        let address = try XCTUnwrap(store.address)
        let root = try XCTUnwrap(store.root?.key)
        // The person's Claude drafts two problems through the address. Neither is published: each waits on the root.
        // Letters alone: the gate reads a long number in a title as contact details.
        let unique = String((0 ..< 10).map { _ in "abcdefghijklmnopqrstuvwxyz".randomElement()! })
        let said = try await call(address, "quilt_publish", pattern("first-" + unique))
        XCTAssertTrue(said.contains("nothing is published yet"), said)
        _ = try await call(address, "quilt_publish", pattern("second-" + unique))
        await store.look()
        XCTAssertEqual(store.waiting.count, 2)
        XCTAssertEqual(store.news?.kind, .asked)
        XCTAssertEqual(store.unseen, 2)
        // The phone reads the first from the text it signs, signs it, and the tracker carries it under the root.
        let waits = try XCTUnwrap(store.waiting.first { $0.envelope.contains("first-" + unique) })
        let draft = try Draft(waits, root: root.address)
        XCTAssertEqual(draft.pieces, 2)
        let published = await store.publish(draft)
        XCTAssertNil(store.problem)
        XCTAssertTrue(published)
        XCTAssertEqual(store.waiting.count, 1)
        let found = try await Tracker.problems(matching: "first-" + unique)
        XCTAssertEqual(found.map(\.problem), [draft.hash])
        // The other still waits, here and at the address, for a run of the app to show.
        await store.look()
        XCTAssertEqual(store.waiting.count, 1)
    }
}
