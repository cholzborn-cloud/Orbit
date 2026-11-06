import XCTest

// Nacht-Auftrag 06.11.2026, Mac-Anbindung: Formen wie im Dienst (service/src/chat/executor.ts, runtime.ts snapshot).
final class MacAnbindungTests: XCTestCase {
    private func line(_ json: String) -> Data { Data(json.utf8) }

    func testTaskBoardSnapshotAndLiveEvents() {
        var board = TaskBoard()
        // Snapshot: TaskRecords (id, parentChatId, orbiId), ohne Titel gilt die erste Zeile des Auftrags.
        board.apply(line: line(#"{"type":"snapshot","tasks":[{"id":"t1","parentChatId":"c1","orbiId":"b1","title":null,"brief":"Suche Flüge\nDetails","progress":"Sucht im Web …","status":"running"}]}"#))
        XCTAssertEqual(board.helpers(forChat: "c1").map(\.title), ["Suche Flüge"])
        XCTAssertEqual(board.helpers(forChat: "c1").first?.progress, "Sucht im Web …")

        // Live: flaches Ereignis mit taskId/chatId/botId.
        board.apply(line: line(#"{"type":"task","action":"start","taskId":"t2","chatId":"c1","botId":"b2","title":"Bericht","brief":"x","status":"running"}"#))
        board.apply(line: line(#"{"type":"task","action":"progress","taskId":"t2","chatId":"c1","botId":"b2","progress":"Liest Datei …","status":"running"}"#))
        XCTAssertEqual(board.helpers(forChat: "c1").map(\.id), ["t1", "t2"])
        XCTAssertEqual(board.helpers(forChat: "c1").last?.progress, "Liest Datei …")
        XCTAssertTrue(board.helpers(forChat: "c2").isEmpty)

        // `stopped` aus dem Executor kommt mit leerem Chat: Entfernen nach taskId.
        board.apply(line: line(#"{"type":"task","action":"stopped","taskId":"t1","chatId":"","botId":"","status":"stopped"}"#))
        board.apply(line: line(#"{"type":"task","action":"done","taskId":"t2","chatId":"c1","botId":"b2","status":"done"}"#))
        XCTAssertTrue(board.helpers.isEmpty)

        // Fortschritt ohne bekannten Chat legt nichts an.
        board.apply(line: line(#"{"type":"task","action":"progress","taskId":"t9","chatId":"","botId":"","status":"running"}"#))
        XCTAssertTrue(board.helpers.isEmpty)
    }
}

final class PromptPreviewTests: XCTestCase {
    private func decode(_ json: String) throws -> PromptPreview { try JSONDecoder().decode(PromptPreview.self, from: Data(json.utf8)) }
    private let layers = #""layers":{"layer1Stable":"A","layer2Tools":"B","layer3Volatile":"C"}"#

    func testSectionsGetVolatileAppended() throws {
        let preview = try decode(#"{"ok":true,"chatId":"c1","#+layers+#","sections":[{"id":"persona","title":"Identität & Rolle","layer":"stable","content":"x"}],"fullPrompt":"x"}"#)
        XCTAssertEqual(preview.shown.map(\.id), ["persona", "volatile"])
        XCTAssertEqual(preview.shown.last?.content, "C")
    }

    func testOlderServiceFallsBackToLayers() throws {
        let preview = try decode("{"+layers+"}")
        XCTAssertEqual(preview.shown.map(\.content), ["A", "B", "C"])
    }
}

final class UndoTargetTests: XCTestCase {
    private func tool(_ name: String, input: [String: JSONValue] = [:], output: [String: JSONValue], state: ToolState = .outputAvailable) -> ToolPart {
        ToolPart(toolCallId: "t", name: name, state: state, input: .object(input), output: .object(output))
    }

    func testMapsSelfChangesToKindAndEntity() {
        let ok: [String: JSONValue] = ["ok": .bool(true)]
        XCTAssertEqual(tool("automation_create", output: ["ok": .bool(true), "id": .string("r1")]).undoTarget(botId: "b")?.entityId, "r1")
        XCTAssertEqual(tool("update_routine", input: ["action": .string("pause"), "id": .string("r2")], output: ok).undoTarget(botId: "b"),
                       UndoTarget(kind: "routine", entityId: "r2", label: "Routine pausiert"))
        XCTAssertEqual(tool("archive_orbi", input: ["id": .string("o1")], output: ok).undoTarget(botId: "b")?.kind, "orbi")
        XCTAssertEqual(tool("propose_profile", output: ok).undoTarget(botId: "b1"), UndoTarget(kind: "profile", entityId: "b1", label: "Profil geändert"))
    }

    func testNoUndoWithoutChangeOrTarget() {
        let ok: [String: JSONValue] = ["ok": .bool(true)]
        XCTAssertNil(tool("update_routine", input: ["action": .string("list")], output: ok).undoTarget(botId: "b"))
        XCTAssertNil(tool("update_orbi", input: [:], output: ok).undoTarget(botId: "b"))
        XCTAssertNil(tool("archive_orbi", input: ["id": .string("o1")], output: ["ok": .bool(false)]).undoTarget(botId: "b"))
        XCTAssertNil(tool("archive_orbi", input: ["id": .string("o1")], output: ok, state: .outputError).undoTarget(botId: "b"))
        XCTAssertNil(tool("propose_profile", output: ok).undoTarget(botId: nil))
        XCTAssertNil(tool("web_search", output: ok).undoTarget(botId: "b"))
    }

    // Lokale Mac-Aktionen (lib/mac): Rückgängig nur mit undoId aus dem Dienst.
    func testMacActionsUndoWithUndoId() {
        XCTAssertEqual(tool("mac_shell", input: ["command": .string("rm a")], output: ["exitCode": .number(0), "undoId": .string("u1")]).undoTarget(botId: "b"),
                       UndoTarget(kind: "mac", entityId: "u1", label: "In den Papierkorb gelegt"))
        XCTAssertEqual(tool("mac_files", input: ["action": .string("move")], output: ["undoId": .string("u2")]).undoTarget(botId: nil)?.label, "Verschoben")
        XCTAssertEqual(tool("mac_calendar", input: ["action": .string("create")], output: ["undoId": .string("u3")]).undoTarget(botId: nil)?.label, "Termin angelegt")
        XCTAssertNil(tool("mac_shell", input: ["command": .string("ls")], output: ["exitCode": .number(0)]).undoTarget(botId: "b"))
        XCTAssertNil(tool("mac_files", input: ["action": .string("trash")], output: ["undoId": .string("u4")], state: .outputError).undoTarget(botId: "b"))
    }

    func testMacPermissionTexts() {
        XCTAssertEqual(MacPermissionText.value("granted"), "Erlaubt")
        XCTAssertEqual(MacPermissionText.value("missing"), "Fehlt")
        XCTAssertEqual(MacPermissionText.value("unknown"), "Noch nicht gefragt")
        let disk = MacAccess.Permission(id: "full_disk", label: "Festplattenvollzugriff", status: "missing", settingsUrl: "x", detail: "")
        let screen = MacAccess.Permission(id: "screen", label: "Bildschirmaufnahme", status: "missing", settingsUrl: "x", detail: "")
        XCTAssertFalse(MacPermissionText.canRequest(disk))
        XCTAssertTrue(MacPermissionText.canRequest(screen))
        let json = #"{"enabled":true,"permissions":[{"id":"screen","label":"Bildschirmaufnahme","status":"granted","settingsUrl":"x-apple.systempreferences:x","detail":"Bildschirm sehen"}]}"#
        XCTAssertEqual(try JSONDecoder().decode(MacAccess.self, from: Data(json.utf8)).permissions.first?.status, "granted")
    }
}
