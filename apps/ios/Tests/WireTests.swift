// The phone's wire held to the reference's (Sources/Wire.swift; docs/v2/WIRE.md): every address, hash, canonical
// form, signature and event id in vectors.json, which Tests/vectors.ts writes from the core, comes out the same here.
import XCTest
@testable import Quilt

final class WireTests: XCTestCase {
    private var vectors: [String: Any] = [:]

    override func setUpWithError() throws {
        let url = try XCTUnwrap(Bundle(for: WireTests.self).url(forResource: "vectors", withExtension: "json"))
        vectors = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func rows(_ name: String) throws -> [[String: Any]] {
        let found = try XCTUnwrap(vectors[name] as? [[String: Any]])
        XCTAssertFalse(found.isEmpty)
        return found
    }

    private func key(_ hex: Any?) throws -> SigningKey {
        try SigningKey(secret: XCTUnwrap(Hex.bytes(XCTUnwrap(hex as? String))))
    }

    func testAnAddressIsTheReferences() throws {
        for row in try rows("keys") {
            XCTAssertEqual(try key(row["secret"]).address, row["address"] as? String)
        }
    }

    func testThePersonalHashIsTheReferences() throws {
        for row in try rows("personal") {
            let text = try XCTUnwrap(row["text"] as? String)
            XCTAssertEqual(Hex.string(Address.personalHash(Array(text.utf8))), row["hash"] as? String, text)
        }
    }

    func testCanonicalJSONIsTheReferences() throws {
        for row in try rows("canonical") {
            let value = try XCTUnwrap(JSON(XCTUnwrap(row["value"])))
            XCTAssertEqual(value.canonical, row["canonical"] as? String)
        }
    }

    func testASignatureIsTheReferences() throws {
        for row in try rows("messages") {
            let text = try XCTUnwrap(row["text"] as? String)
            XCTAssertEqual(try key(row["secret"]).sign(Array(text.utf8)), row["sig"] as? String, text)
        }
    }

    func testAnEventsIdAndSignaturesAreTheReferences() throws {
        for row in try rows("events") {
            let written = try XCTUnwrap(JSON(XCTUnwrap(row["event"])))
            guard case .object(let fields) = written else { return XCTFail("an event is an object") }
            var event = try XCTUnwrap(WireEvent(written))
            XCTAssertEqual(event.id, row["id"] as? String)
            try event.sign(with: key(row["signer"]))
            if !(row["second"] is NSNull) { try event.sign(with: key(row["second"]), in: "sig_to") }
            let posted = try XCTUnwrap(JSON(JSONSerialization.jsonObject(with: event.posted)))
            XCTAssertEqual(posted, .object(fields))
        }
    }

    func testAKeyMadeHereSignsAsItsAddress() throws {
        let made = try SigningKey.make()
        XCTAssertEqual(made.address.count, 42)
        XCTAssertEqual(try SigningKey(secret: made.secret), made)
        XCTAssertEqual(try made.sign(Array("x".utf8)).count, 132)
    }

    func testATimeIsToTheMillisecondWithZ() {
        XCTAssertEqual(WireEvent.time(Date(timeIntervalSince1970: 1_763_239_115.828)), "2025-11-15T20:38:35.828Z")
    }

    /// A publish that waits: the draft is read from the text the root signs, and the phone's signature over that
    /// text and its version of the problem are the reference's.
    func testADraftIsReadFromTheTextItSignsAndSignedAsTheReference() throws {
        let v = try XCTUnwrap(vectors["draft"] as? [String: Any])
        let key = try SigningKey(secret: XCTUnwrap(Hex.bytes(v["signer"] as! String)))
        let envelope = v["envelope"] as! String
        let waiting = Waiting(id: v["hash"] as! String, kind: "publish", at: "", expires: "", root: key.address, envelope: envelope, topics: [], left: [])
        let draft = try Draft(waiting, root: key.address)
        XCTAssertEqual(draft.title, "Does the paper say this, in these words?")
        XCTAssertEqual(draft.doneWhen, "Every sentence has two readings: \"agreed\", or kept apart.")
        XCTAssertEqual(draft.slug, "paper-sentences")
        XCTAssertEqual(draft.families.map(\.name), ["sentence/*", "summary"])
        XCTAssertEqual(draft.families.map(\.count), [3, 1])
        XCTAssertEqual(draft.pieces, 4)
        XCTAssertFalse(draft.replaces)

        let version = try XCTUnwrap(v["version"] as? [String: Any])
        let at = try XCTUnwrap(moment(version["ts"] as! String))
        let answered = try XCTUnwrap(JSONSerialization.jsonObject(with: draft.answer(signedBy: key, at: at)) as? [String: Any])
        XCTAssertEqual(answered["sig"] as? String, v["sig"] as? String)
        XCTAssertEqual(JSON(answered["version"]!), JSON(version))
    }

    /// What the phone will not sign: text that is not canonical, a draft owned by another key, one listed under
    /// another hash, and one that holds a number that is not whole.
    func testADraftThatIsNotWhatItSaysIsNotSigned() throws {
        let v = try XCTUnwrap(vectors["draft"] as? [String: Any])
        let key = try SigningKey(secret: XCTUnwrap(Hex.bytes(v["signer"] as! String)))
        let other = try SigningKey(secret: [UInt8](repeating: 0, count: 31) + [1])
        let envelope = v["envelope"] as! String
        let hash = v["hash"] as! String
        let waits = { (id: String, root: String, text: String) in
            Waiting(id: id, kind: "publish", at: "", expires: "", root: root, envelope: text, topics: [], left: [])
        }
        XCTAssertNoThrow(try Draft(waits(hash, key.address, envelope), root: key.address))
        XCTAssertThrowsError(try Draft(waits(hash, key.address, envelope.replacingOccurrences(of: "\"quilt\":1", with: "\"quilt\": 1")), root: key.address))
        XCTAssertThrowsError(try Draft(waits(hash, key.address, envelope), root: other.address))
        XCTAssertThrowsError(try Draft(waits(hash, other.address, envelope), root: key.address))
        XCTAssertThrowsError(try Draft(waits("sha256:" + String(repeating: "0", count: 64), key.address, envelope), root: key.address))
        XCTAssertThrowsError(try Draft(waits(hash, key.address, envelope.replacingOccurrences(of: "\"count\":3", with: "\"count\":3.5")), root: key.address))
        XCTAssertThrowsError(try Draft(waits(hash, key.address, envelope.replacingOccurrences(of: "these words?", with: "other words?")), root: key.address))
        XCTAssertThrowsError(try Draft(waits(hash, key.address, envelope), root: key.address).answer(signedBy: other))
    }
}
