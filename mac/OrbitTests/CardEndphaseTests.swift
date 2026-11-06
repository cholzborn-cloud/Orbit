import XCTest

final class CardEndphaseTests: XCTestCase {
    func testStructuredAutomationAndTimestampDecodeWithoutTextParsing() throws {
        let raw = #"{"id":"m","role":"user","parts":[],"metadata":{"createdAt":42,"automation":{"automationId":"a","runId":"r","name":"Briefing","status":"waiting","startedAt":42}}}"#
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(raw.utf8))
        XCTAssertEqual(message.metadata?.createdAt, 42)
        XCTAssertEqual(message.metadata?.automation?.label, "Briefing wartet …")
        XCTAssertEqual(message.metadata?.automation?.active, true)
    }

    func testMalformedAutomationDoesNotDiscardMessageMetadata() throws {
        let raw = #"{"createdAt":42,"automation":{"name":7},"model":"test"}"#
        let meta = try JSONDecoder().decode(ChatMetadata.self, from: Data(raw.utf8))
        XCTAssertNil(meta.automation)
        XCTAssertEqual(meta.model, "test")
        XCTAssertEqual(meta.createdAt, 42)
    }

    func testAutomationFailureAndMerge() {
        let run = AutomationMessage(automationId: "a", runId: "r", name: "Briefing", status: "error", startedAt: 42)
        XCTAssertTrue(run.failed)
        XCTAssertFalse(run.active)
        XCTAssertEqual(run.label, "Briefing fehlgeschlagen")
        var meta = ChatMetadata(createdAt: 42, automation: run)
        meta.merge(ChatMetadata(model: "test"))
        XCTAssertEqual(meta.createdAt, 42)
        XCTAssertEqual(meta.automation, run)
    }
}
