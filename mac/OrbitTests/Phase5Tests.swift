import XCTest

// Phase 5: Jobs, Seitenleisten-Status, Einrichtung, Schlüssel, Tagesbudget, Heartbeat, Gedächtnis ändern. Nie der echte Schlüsselbund, nie ein echter Dienst.
final class Phase5Tests: XCTestCase {
    private func dec<T: Decodable>(_ type: T.Type, _ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }

    func testInterruptedInfoInMessagesResponse() throws {
        let with = try dec(MessagesResponse.self, #"{"messages":[],"interrupted":{"runId":"r1","at":1700000000000,"steps":3,"x":1}}"#)
        XCTAssertEqual(with.interrupted?.runId, "r1")
        XCTAssertEqual(with.interrupted?.steps, 3)
        XCTAssertNil(try dec(MessagesResponse.self, #"{"messages":[],"interrupted":null}"#).interrupted)
        XCTAssertNil(try dec(MessagesResponse.self, #"{"messages":[]}"#).interrupted)
        // Kaputtes Feld verwirft die Nachrichten nicht.
        XCTAssertNil(try dec(MessagesResponse.self, #"{"messages":[],"interrupted":{"steps":1}}"#).interrupted)
        XCTAssertEqual(Phase5Paths.resume(chatId: "a/b"), "/v1/chats/a%2Fb/resume")
    }

    func testSidebarDotsAreOnlyForWorkNeedsYouNewAndInterrupted() throws {
        let status = try dec(ChatStatusResponse.self, #"{"ok":true,"chats":[{"chatId":"n","isNew":true},{"chatId":"i","interrupted":true},{"chatId":"w","working":true,"needsYou":true},{"kaputt":1}],"needsYou":1}"#)
        var board = SidebarStatus()
        board.apply(status)
        XCTAssertEqual(board.needsYouCount, 1)
        XCTAssertEqual(board.dot(chatIds: ["x"], state: .done), .done)
        XCTAssertEqual(board.dot(chatIds: ["x"], state: .waiting), .needsYou)
        XCTAssertNil(board.dot(chatIds: ["x"], state: .working))
        XCTAssertNil(board.dot(chatIds: ["n"], state: .working))
        XCTAssertEqual(board.dot(chatIds: ["n"], state: .calm), .done)
        XCTAssertEqual(board.dot(chatIds: ["i"], state: .calm), .needsYou)
        XCTAssertEqual(board.dot(chatIds: ["w"], state: .calm), .needsYou)
        board.seen(chatId: "n"); board.resumed(chatId: "i")
        XCTAssertNil(board.dot(chatIds: ["n"], state: .calm))
        XCTAssertNil(board.dot(chatIds: ["i"], state: .calm))
        for state in OrbiState.allCases {
            XCTAssertFalse(state.caption.localizedCaseInsensitiveContains("limit"), state.caption)
            XCTAssertFalse((state.statusDescription ?? "").localizedCaseInsensitiveContains("limit"))
        }
        XCTAssertEqual(OrbiState.limit.caption, "Pausiert, wartet")
    }

    // Consti 06.11.: blauer Punkt nie am offenen Chat, auch nicht, wenn der Dienst ihn als neu meldet oder er gerade fertig wurde.
    func testOpenChatNeverShowsUnreadDot() throws {
        let status = try dec(ChatStatusResponse.self, #"{"ok":true,"chats":[{"chatId":"n","isNew":true},{"chatId":"i","interrupted":true}],"needsYou":0}"#)
        var board = SidebarStatus()
        board.apply(status)
        XCTAssertNil(board.dot(chatIds: ["n"], state: .calm, openChatId: "n"))
        XCTAssertNil(board.dot(chatIds: ["x"], state: .done, openChatId: "x"))
        XCTAssertEqual(board.dot(chatIds: ["n"], state: .calm, openChatId: "x"), .done)   // anderer Chat offen: Punkt bleibt
        XCTAssertEqual(board.dot(chatIds: ["x"], state: .waiting, openChatId: "x"), .needsYou)   // „braucht dich“ ist kein Ungelesen-Punkt
        XCTAssertEqual(board.dot(chatIds: ["i"], state: .calm, openChatId: "i"), .needsYou)
    }

    func testHealthDecodeAndNotificationRows() throws {
        let r = try dec(HealthResponse.self, #"{"ok":true,"checks":[{"id":"proxy","label":"Proxy","state":"ok","key":"CLI_PROXY_API_KEY"},{"id":"jev","label":"Jev","state":"fehler","fix":"Setze einen neuen Schlüssel.","key":"OPENROUTER_JEV_API_KEY","optional":true},{"id":"x","label":"X","state":"was-neues"},{"kaputt":1}]}"#)
        XCTAssertEqual(r.checks.map(\.id), ["proxy", "jev", "x"])
        XCTAssertEqual(r.checks[1].state, .fehler)
        XCTAssertTrue(r.checks[1].optional)
        XCTAssertEqual(r.checks[2].state, .fehler)   // unbekannter Zustand gilt vorsichtig als Fehler
        XCTAssertEqual(try dec(HealthResponse.self, "{}").checks.count, 0)
        XCTAssertEqual(NotificationAccess.allowed.check.state, .ok)
        XCTAssertEqual(NotificationAccess.undecided.check.state, .fehlt)
        XCTAssertEqual(NotificationAccess.denied.check.state, .fehler)
        XCTAssertFalse(NotificationAccess.denied.check.fix?.isEmpty ?? true)
    }

    func testBudgetDecodeAndTexts() throws {
        let b = try dec(BudgetState.self, #"{"ok":true,"budget":{"jevDailyUsd":0.5,"maxSandboxes":3},"jev":{"spentUsd":0.41,"state":"hinweis","percent":82},"sandboxes":{"active":3,"max":3,"waiting":true},"tokens":[{"botId":"a","turns":2,"inputTokens":1,"outputTokens":1,"totalTokens":12345},{"x":1}]}"#)
        XCTAssertEqual(b.jevState, .hinweis)
        XCTAssertEqual(b.tokens.count, 1)
        XCTAssertEqual(BudgetText.jevNotice(b), "Das Tagesbudget für Jev ist zu 82 % verbraucht.")
        XCTAssertEqual(BudgetText.sandboxNotice(b), "Neue Sandboxes warten, bis eine frei wird.")
        var off = b; off.jevState = .aus
        XCTAssertEqual(BudgetText.jevNotice(off), "Jev pausiert für heute. „Auto“ nimmt das Standardmodell des Orbis.")
        var ok = b; ok.jevState = .ok; ok.sandboxesWaiting = false
        XCTAssertNil(BudgetText.jevNotice(ok)); XCTAssertNil(BudgetText.sandboxNotice(ok))
        for text in [BudgetText.jevNotice(b), BudgetText.jevNotice(off), BudgetText.sandboxNotice(b)] { XCTAssertFalse((text ?? "").localizedCaseInsensitiveContains("limit")) }
        XCTAssertEqual(BudgetText.dollars(0.5), "0,50 $")
        XCTAssertEqual(BudgetText.tokens(950), "950")
        XCTAssertEqual(BudgetText.tokens(12345), "12 Tsd.")
        XCTAssertEqual(try dec(BudgetState.self, "{}").maxSandboxes, 3)
    }

    func testHeartbeatDecodeAndPaths() throws {
        let h = try dec(HeartbeatState.self, #"{"ok":true,"enabled":true,"everyMinutes":30,"window":{"from":"08:00","to":"22:00"},"lastRunAt":null}"#)
        XCTAssertTrue(h.enabled); XCTAssertEqual(h.everyMinutes, 30); XCTAssertEqual(h.to, "22:00")
        XCTAssertFalse(try dec(HeartbeatState.self, "{}").enabled)
        XCTAssertEqual(Phase5Paths.heartbeat(botId: "b 1"), "/v1/bots/b%201/heartbeat")
        XCTAssertEqual(Phase5Paths.memoryTrash(botId: "b"), "/v1/bots/b/memory-trash")
        XCTAssertEqual(Phase5Paths.restore(botId: "b", name: "a/b"), "/v1/bots/b/memory/a%2Fb/restore")
    }

    func testMemorySavedLineOnlyForSuccessfulSave() throws {
        func part(_ state: ToolState, ok: Bool?) -> ToolPart {
            var tool = ToolPart(toolCallId: "t", name: "memory_save", state: state)
            if let ok { tool.output = .object(["ok": .bool(ok)]) }
            return tool
        }
        XCTAssertTrue(part(.outputAvailable, ok: true).memorySaved)
        XCTAssertFalse(part(.outputAvailable, ok: false).memorySaved)
        XCTAssertFalse(part(.inputAvailable, ok: nil).memorySaved)
        var other = part(.outputAvailable, ok: true); other.name = "memory_get"
        XCTAssertFalse(other.memorySaved)
    }
}

private final class FakeKeyStore: KeyStoring, @unchecked Sendable {
    var saved: [String: String] = [:]
    var fail = false
    func save(name: String, value: String) -> Bool { if fail { return false }; saved[name] = value; return true }
}

private final class FakeSetup: SetupService, @unchecked Sendable {
    var reloaded: [[String]] = []
    var restart: [String] = []
    var failReload = false
    var checksList = [HealthCheck(id: "daytona", label: "Daytona", state: .fehlt, fix: "Setze den Daytona-Schlüssel.", key: "DAYTONA_API_KEY")]
    var budget = BudgetState()
    struct Boom: LocalizedError { var errorDescription: String? { "kaputt" } }
    func healthChecks() async throws -> [HealthCheck] { checksList }
    func keys() async throws -> KeysResponse { try JSONDecoder().decode(KeysResponse.self, from: Data(#"{"keys":[{"name":"DAYTONA_API_KEY","label":"Daytona","set":false}]}"#.utf8)) }
    func reloadKeys(names: [String]) async throws -> KeysResponse {
        if failReload { throw Boom() }
        reloaded.append(names)
        let json = #"{"keys":[{"name":"\#(names[0])","label":"X","set":true}],"needsRestart":[\#(restart.map { "\"\($0)\"" }.joined(separator: ","))]}"#
        return try JSONDecoder().decode(KeysResponse.self, from: Data(json.utf8))
    }
    func budget() async throws -> BudgetState { budget }
    func setBudget(jevDailyUsd: Double?, maxSandboxes: Int?) async throws -> BudgetState {
        if let jevDailyUsd { budget.jevDailyUsd = jevDailyUsd }
        if let maxSandboxes { budget.maxSandboxes = maxSandboxes }
        return budget
    }
}

@MainActor
final class SetupModelTests: XCTestCase {
    private func model(_ service: FakeSetup, _ store: FakeKeyStore) -> SetupModel {
        SetupModel(service: service, keyStore: store, notificationAccess: { .allowed })
    }

    func testLoadShowsChecksAndRequiredProblem() async {
        let service = FakeSetup(), m = model(service, FakeKeyStore())
        await m.load()
        XCTAssertEqual(m.checks.value?.count, 1)
        XCTAssertEqual(m.rows.map(\.id), ["daytona", "notifications"])
        XCTAssertTrue(m.hasRequiredProblem)
        XCTAssertFalse(m.isSet("DAYTONA_API_KEY"))
        service.checksList = [HealthCheck(id: "jev", label: "Jev", state: .fehlt, optional: true)]
        await m.load()
        XCTAssertFalse(m.hasRequiredProblem)   // optionale Dienste zählen nicht
    }

    func testSetKeyWritesKeychainThenReloadsAndNeverKeepsTheValue() async {
        let service = FakeSetup(), store = FakeKeyStore(), m = model(service, store)
        await m.load()
        let ok = await m.setKey("DAYTONA_API_KEY", value: "  geheim-123  ")
        XCTAssertTrue(ok)
        XCTAssertEqual(store.saved, ["DAYTONA_API_KEY": "geheim-123"])
        XCTAssertEqual(service.reloaded, [["DAYTONA_API_KEY"]])   // dem Dienst geht nur der Name, nie der Wert
        XCTAssertTrue(m.isSet("DAYTONA_API_KEY"))
        XCTAssertNil(m.keyError)
        XCTAssertTrue(m.needsRestart.isEmpty)
        service.restart = ["CLI_PROXY_API_KEY"]
        _ = await m.setKey("CLI_PROXY_API_KEY", value: "p")
        XCTAssertEqual(m.needsRestart, ["CLI_PROXY_API_KEY"])
    }

    func testSetKeyErrors() async {
        let service = FakeSetup(), store = FakeKeyStore(), m = model(service, store)
        let empty = await m.setKey("DAYTONA_API_KEY", value: "   ")
        XCTAssertFalse(empty)
        XCTAssertTrue(store.saved.isEmpty)
        XCTAssertTrue(service.reloaded.isEmpty)
        store.fail = true
        let notSaved = await m.setKey("DAYTONA_API_KEY", value: "x")
        XCTAssertFalse(notSaved)
        XCTAssertEqual(m.keyError, "Der Schlüssel konnte nicht im Schlüsselbund gespeichert werden.")
        XCTAssertTrue(service.reloaded.isEmpty)
        store.fail = false; service.failReload = true
        let saved = await m.setKey("DAYTONA_API_KEY", value: "y")
        XCTAssertTrue(saved)   // im Schlüsselbund, der Dienst liest ihn beim nächsten Start
        XCTAssertTrue(m.isSet("DAYTONA_API_KEY"))
        XCTAssertTrue(m.needsRestart.contains("DAYTONA_API_KEY"))
    }

    func testBudgetSaveUpdatesState() async {
        let service = FakeSetup(), m = model(service, FakeKeyStore())
        await m.loadBudget()
        await m.saveBudget(jevDailyUsd: 1.25)
        XCTAssertEqual(m.budget.value?.jevDailyUsd, 1.25)
        await m.saveBudget(maxSandboxes: 2)
        XCTAssertEqual(m.budget.value?.maxSandboxes, 2)
        XCTAssertEqual(m.budget.value?.jevDailyUsd, 1.25)
    }
}
