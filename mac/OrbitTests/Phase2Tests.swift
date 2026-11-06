import XCTest

// Phase 2, Lauf B: Root-Karten mit Absender, hinfällige Karten, Gruppenrunden, Verlauf neu laden, Mitteilungen, `modelPinned`.
final class Phase2Tests: XCTestCase {
    private func apply(_ board: inout InteractionBoard, _ json: String) { board.apply(line: Data(json.utf8)) }

    private func interaction(kind: String, id: String, chatId: String, rootChat: String?, status: String = "pending") -> String {
        let root = rootChat.map { ##","root":{"chatId":"\##($0)","taskId":"t1"},"from":{"id":"b1","name":"Nova","avatar":"nova","color":"#55b6c3"}"## } ?? ""
        let type = kind == "ask" ? "question" : "approval"
        let tool = kind == "ask" ? "ask_user" : "bash"
        return #"{"type":"\#(type)","status":"\#(status)","id":"\#(id)","kind":"\#(kind)","chatId":"\#(chatId)","botId":"b1","toolCallId":"\#(id)","tool":"\#(tool)","input":{},"requestedAt":1000,"expiresAt":90000000\#(root)}"#
    }

    // MARK: Root-Karten

    func testRootCardAppearsInRootChatWithSender() throws {
        var board = InteractionBoard()
        apply(&board, interaction(kind: "approval", id: "a1", chatId: "chat-b", rootChat: "chat-a"))
        apply(&board, interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a"))
        let cards = board.rootCards(forChat: "chat-a")
        XCTAssertEqual(cards.map(\.id), ["a1", "q1"])
        let sender = try XCTUnwrap(cards.first?.from)
        XCTAssertEqual(sender.name, "Nova")
        XCTAssertEqual(sender.avatar, "nova")
        XCTAssertEqual(sender.color, "#55b6c3")
        XCTAssertEqual(cards.first?.root?.taskId, "t1")
        XCTAssertEqual(cards.first?.displayChatId, "chat-a")
        // Im Chat des Fragenden steht die Karte nicht als Root-Karte (dort die gewohnte Karte), anderswo auch nicht.
        XCTAssertTrue(board.rootCards(forChat: "chat-b").isEmpty)
        XCTAssertTrue(board.rootCards(forChat: "chat-x").isEmpty)
        XCTAssertEqual(board.pending(forChat: "chat-b").count, 2)
    }

    func testCardWithoutRootFieldsIsNotARootCard() {
        var board = InteractionBoard()
        apply(&board, interaction(kind: "approval", id: "a1", chatId: "chat-a", rootChat: nil))
        XCTAssertTrue(board.rootCards(forChat: "chat-a").isEmpty)
        // Fragt der Root-Orbi selbst (root.chatId == chatId), gibt es nur eine Karte, die gewohnte.
        apply(&board, interaction(kind: "ask", id: "q9", chatId: "chat-a", rootChat: "chat-a"))
        XCTAssertTrue(board.rootCards(forChat: "chat-a").isEmpty)
    }

    func testSnapshotCarriesRootCardsAndSurvivesBrokenEntries() {
        var board = InteractionBoard()
        let good = interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a").replacingOccurrences(of: #""type":"question","status":"pending","#, with: "")
        apply(&board, #"{"type":"snapshot","approvals":[{"kaputt":true},\#(good)],"working":[],"automations":[]}"#)
        XCTAssertEqual(board.rootCards(forChat: "chat-a").map(\.id), ["q1"])
    }

    func testAbortedAndExpiredCardsDisappear() {
        var board = InteractionBoard()
        apply(&board, interaction(kind: "approval", id: "a1", chatId: "chat-b", rootChat: "chat-a"))
        apply(&board, interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a"))
        apply(&board, interaction(kind: "approval", id: "a1", chatId: "chat-b", rootChat: "chat-a", status: "aborted"))
        apply(&board, interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a", status: "expired"))
        XCTAssertTrue(board.rootCards(forChat: "chat-a").isEmpty)
        XCTAssertEqual(board.resolved["a1"], "aborted")
        XCTAssertEqual(board.resolved["q1"], "expired")
    }

    func testAnsweredCardDisappears() {
        var board = InteractionBoard()
        apply(&board, interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a"))
        apply(&board, interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a", status: "answered"))
        XCTAssertTrue(board.rootCards(forChat: "chat-a").isEmpty)
    }

    // MARK: Gruppenrunde und Verlauf

    func testGroupRoundLifecycle() {
        var board = InteractionBoard()
        XCTAssertFalse(board.isRoundActive(chatId: "g"))
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"start"}"#)
        XCTAssertTrue(board.isRoundActive(chatId: "g"))
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"silent","botId":"b1"}"#)
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"reply","botId":"b2","messageId":"m"}"#)
        XCTAssertTrue(board.isRoundActive(chatId: "g"))
        XCTAssertFalse(board.wasRoundStopped(chatId: "g"))
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"end"}"#)
        XCTAssertFalse(board.isRoundActive(chatId: "g"))
        XCTAssertFalse(board.wasRoundStopped(chatId: "g"))
    }

    func testStoppedRoundIsShownUntilNextStart() {
        var board = InteractionBoard()
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"start"}"#)
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"end","stopped":true}"#)
        XCTAssertTrue(board.wasRoundStopped(chatId: "g"))
        apply(&board, #"{"type":"group-turn","chatId":"g","phase":"start"}"#)
        XCTAssertFalse(board.wasRoundStopped(chatId: "g"))
        // Verbindung neu aufgebaut: der Snapshot kennt keine Runde, ein hängender Zustand bleibt nie stehen.
        apply(&board, #"{"type":"snapshot","approvals":[],"working":[],"automations":[]}"#)
        XCTAssertFalse(board.isRoundActive(chatId: "g"))
    }

    func testHistoryChangeEvents() {
        func chat(_ json: String) -> String? { InteractionBoard.historyChat(in: Data(json.utf8)) }
        XCTAssertEqual(chat(#"{"type":"orbi-message","chatId":"c1","messageId":"m","linkId":"l","direction":"out","kind":"message","status":"arbeitet"}"#), "c1")
        XCTAssertEqual(chat(#"{"type":"group-turn","chatId":"g","phase":"reply"}"#), "g")
        XCTAssertEqual(chat(#"{"type":"group-turn","chatId":"g","phase":"end","stopped":true}"#), "g")
        XCTAssertNil(chat(#"{"type":"status","chatId":"c1","botId":"b","status":"arbeitet"}"#))
        XCTAssertNil(chat(#"{"type":"handoff","chatId":"c1"}"#))
        XCTAssertNil(chat("kaputt"))
    }

    func testOldHandoffEventIsIgnored() {
        var board = InteractionBoard()
        let before = board
        apply(&board, #"{"type":"handoff","chatId":"c","botId":"b","handoffId":"h","to":"z","status":"running"}"#)
        XCTAssertEqual(board, before)
    }

    // MARK: Mitteilungen

    func testNoticeOpensRootChatAndNamesSender() {
        var board = InteractionBoard()
        apply(&board, interaction(kind: "ask", id: "q1", chatId: "chat-b", rootChat: "chat-a"))
        var planner = NoticePlanner()
        let notices = planner.notices(for: board, botName: { _ in "Anderer" })
        XCTAssertEqual(notices.count, 1)
        XCTAssertEqual(notices.first?.chatId, "chat-a")
        XCTAssertEqual(notices.first?.title, "Nova hat eine Frage")
    }

    func testNoticeWithoutRootKeepsOwnChat() {
        var board = InteractionBoard()
        apply(&board, interaction(kind: "approval", id: "a1", chatId: "chat-a", rootChat: nil))
        var planner = NoticePlanner()
        let notice = planner.notices(for: board, botName: { _ in "Trixi" }).first
        XCTAssertEqual(notice?.chatId, "chat-a")
        XCTAssertEqual(notice?.title, "Trixi braucht deine Freigabe")
    }

    // MARK: Modell festnageln

    func testModelPinnedOnlyOnExplicitChoice() {
        XCTAssertEqual(ModelPin.clientValue(pinned: true, isAuto: false), true)
        XCTAssertNil(ModelPin.clientValue(pinned: false, isAuto: false))
        // Auto (Jev) ist keine ausdrückliche Modellwahl.
        XCTAssertNil(ModelPin.clientValue(pinned: true, isAuto: true))
        XCTAssertNil(ModelPin.clientValue(pinned: false, isAuto: true))
    }
}
