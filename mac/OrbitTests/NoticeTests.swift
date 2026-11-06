import XCTest

final class NoticeTests: XCTestCase {
    private func board(_ approvals: String) -> InteractionBoard {
        var board = InteractionBoard()
        board.apply(line: Data("{\"type\":\"snapshot\",\"approvals\":[\(approvals)],\"working\":[],\"automations\":[]}".utf8))
        return board
    }

    private func item(_ id: String, kind: String, tool: String) -> String {
        "{\"id\":\"\(id)\",\"kind\":\"\(kind)\",\"chatId\":\"c1\",\"botId\":\"b1\",\"toolCallId\":\"t-\(id)\",\"tool\":\"\(tool)\",\"input\":{\"command\":\"echo geheim-123\"},\"requestedAt\":1000,\"expiresAt\":601000}"
    }

    @MainActor func testApprovalAndQuestionNoticesOncePerId() {
        var planner = NoticePlanner()
        let both = board(item("a1", kind: "approval", tool: "bash") + "," + item("q1", kind: "ask", tool: "ask_user"))
        let first = planner.notices(for: both, botName: { $0 == "b1" ? "Nepi" : nil })
        XCTAssertEqual(first.map(\.kind), [.approval, .question])
        XCTAssertEqual(first[0].title, "Nepi braucht deine Freigabe")
        XCTAssertEqual(first[0].body, "Werkzeug: bash")
        XCTAssertFalse(first.contains { $0.body.contains("geheim") || $0.title.contains("geheim") }, "Eingaben gehören nicht in Mitteilungen")
        XCTAssertTrue(planner.notices(for: both, botName: { _ in "Nepi" }).isEmpty, "dieselbe ID nur einmal")
        let more = board(item("a2", kind: "approval", tool: "bash"))
        XCTAssertEqual(planner.notices(for: more, botName: { _ in nil }).first?.title, "Ein Orbi braucht deine Freigabe")
    }

    func testAutomationNotice() throws {
        let automation = try JSONDecoder().decode(Automation.self, from: Data("""
        {"id":"x","userId":"local","botId":"b1","name":"Morgens Hallo","prompt":"p","schedule":{"kind":"daily","at":"07:00"},"timezone":"Europe/Berlin","target":"new","chatId":null,"notify":"app","model":null,"effort":null,"context":true,"enabled":true,"pausedReason":null,"lastRunAt":null,"resumedAt":null,"nextRunAt":null,"deletedAt":null,"createdAt":1}
        """.utf8))
        let done = AutomationEvent(json: ["automationId": "x", "runId": "r1", "chatId": "c9", "status": "ok"])!
        XCTAssertEqual(NoticePlanner.finished(done, automation: automation)?.title, "„Morgens Hallo“ ist fertig")
        XCTAssertEqual(NoticePlanner.finished(done, automation: automation)?.chatId, "c9")
        let failed = AutomationEvent(json: ["automationId": "x", "runId": "r2", "status": "error", "error": "Proxy aus"])!
        XCTAssertEqual(NoticePlanner.finished(failed, automation: automation)?.body, "Proxy aus")
        let running = AutomationEvent(json: ["automationId": "x", "runId": "r3", "status": "running"])!
        XCTAssertNil(NoticePlanner.finished(running, automation: automation))
        XCTAssertNil(NoticePlanner.finished(done, automation: nil))
        var quiet = automation; quiet.notify = "none"
        XCTAssertNil(NoticePlanner.finished(done, automation: quiet))
    }
}
