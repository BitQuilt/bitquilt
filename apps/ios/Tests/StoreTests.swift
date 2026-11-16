// The store's own acts against a real door, as a tap would start them (Sources/Store.swift): a join that makes the
// root here and delegates to the new address at once, and an address the tracker held as a root brought under a
// fresh root of this phone's by a rotation. They write this app's keychain, so they run in the simulator alone, and
// only where TEST_RUNNER_QUILT_TEST_TRACKER names an on-ramp that holds a problem, as DoorTests.swift says.
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
            UserDefaults.standard.removeObject(forKey: "address")
            Keychain.delete()
            RootStore.delete()
        #endif
    }

    override func tearDown() async throws {
        UserDefaults.standard.removeObject(forKey: "tracker")
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
}
