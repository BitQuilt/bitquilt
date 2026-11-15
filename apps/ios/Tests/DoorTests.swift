// The phone's root against a real door: a join, a delegation the tracker counts, a rotation the on-ramp signs as the
// old root, and a revoke (Sources/Root.swift; docs/PROTOCOL.md, Identity: roots and delegates). It runs where
// TEST_RUNNER_QUILT_TEST_TRACKER names an on-ramp that holds a problem, since a tracker that holds none folds no root,
// and is skipped elsewhere:
//   TEST_RUNNER_QUILT_TEST_TRACKER=http://localhost:3977/ xcodebuild test ...
import XCTest
@testable import Quilt

final class DoorTests: XCTestCase {
    override func setUpWithError() throws {
        guard let tracker = ProcessInfo.processInfo.environment["QUILT_TEST_TRACKER"], !tracker.isEmpty else {
            throw XCTSkip("no on-ramp named in QUILT_TEST_TRACKER")
        }
        UserDefaults.standard.set(tracker, forKey: "tracker")
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: "tracker")
    }

    func testADelegationAtTheJoinIsCountedAndARevokeEndsIt() async throws {
        let root = try SigningKey.make()
        let joined = try await Tracker.join()
        let before = try await Tracker.standing(of: joined.address)
        XCTAssertEqual(before.root, joined.address)
        try await Identity.delegate(root, to: joined.address)
        let counted = try await Tracker.standing(of: joined.address)
        XCTAssertEqual(counted.root, root.address)
        let sheet = try await Tracker.sheet(at: joined.url)
        XCTAssertEqual(sheet.standing?.root, root.address)
        try await Identity.revoke(root, of: joined.address)
        try await Task.sleep(for: .milliseconds(300))
        let after = try await Tracker.standing(of: joined.address)
        XCTAssertEqual(after.root, joined.address)
    }

    func testARotationHandsAnAddressToThePhonesRoot() async throws {
        let root = try SigningKey.make()
        let joined = try await Tracker.join()
        try await Identity.rotate(at: joined.url, from: joined.address, to: root)
        let counted = try await Tracker.standing(of: joined.address)
        XCTAssertEqual(counted.root, root.address)
        // The same rotation again, as after a lost answer, changes nothing and is not refused.
        try await Identity.rotate(at: joined.url, from: joined.address, to: root)
    }

    func testARootThatHasSignedTakesInNoAddressThatHasSigned() async throws {
        let root = try SigningKey.make()
        let first = try await Tracker.join()
        try await Identity.delegate(root, to: first.address)
        let second = try await Tracker.join()
        do {
            try await Identity.rotate(at: second.url, from: second.address, to: root)
            XCTFail("a rotation to a root with a prior event is dropped by the fold")
        } catch let refusal as TrackerError {
            XCTAssertTrue(refusal.errorDescription?.contains("does not count it") ?? false)
        }
    }
}
