import XCTest

final class Phase4Tests: XCTestCase {
    private func dec<T: Decodable>(_ type: T.Type, _ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }

    func testMemoryListToleratesBrokenFields() throws {
        let list = try dec(MemoryList.self, #"{"ok":true,"entries":[{"name":"tee","type":"user","description":"Mag Tee","stated":true,"origin":"consti","updatedAt":1700000000000,"zusatz":1},{"kaputt":1},{"name":"x","stated":"nein","version":"3"}],"index":"- tee","limits":{"entries":40}}"#)
        XCTAssertEqual(list.entries.map(\.name), ["tee", "x"])
        XCTAssertEqual(list.entries[0].typeLabel, "Über dich")
        XCTAssertEqual(list.entries[0].originLabel, "Von dir")
        XCTAssertEqual(list.entries[1].version, 3)
        XCTAssertEqual(list.maxEntries, 40)
        XCTAssertEqual(list.sorted.first?.name, "tee")
        XCTAssertEqual(try dec(MemoryList.self, "{}").entries.count, 0)
    }

    func testInfoForOldAnswerWithoutMetadata() {
        let rows = Dictionary(InfoText.compactRows(ChatMetadata()), uniquingKeysWith: { first, _ in first })
        XCTAssertEqual(rows["Modell"], "–")
        XCTAssertEqual(rows["Dauer"], "–")
        XCTAssertNotNil(rows["Tokens"])
    }

    func testDreamerDecodeAndLabels() throws {
        let d = try dec(DreamerState.self, #"{"ok":true,"enabled":false,"lastRunAt":1700000000000,"changes":[{"id":1,"name":"a","action":"dream-merge","at":1700000000000},{"x":1}],"runs":[]}"#)
        XCTAssertFalse(d.enabled)
        XCTAssertEqual(d.changes.map(\.actionLabel), ["Zusammengeführt"])
        XCTAssertNotNil(d.lastRunAt)
    }

    func testPathsEncodeNames() {
        XCTAssertEqual(MemoryPaths.entry(botId: "b1", name: "a/b ?"), "/v1/bots/b1/memory/a%2Fb%20%3F")
        XCTAssertEqual(MemoryPaths.dreamer(botId: "b1"), "/v1/bots/b1/dreamer")
    }

    func testInfoTexts() throws {
        func rows(_ jev: String, extra: String = "") throws -> [String: String] {
            let meta = try dec(ChatMetadata.self, #"{"model":"Sonnet","jev":\#(jev)\#(extra)}"#)
            return Dictionary(InfoText.rows(meta), uniquingKeysWith: { a, _ in a })
        }
        XCTAssertEqual(try rows(#"{"reason":"einfach","change":"start","tier":"small","modelLabel":"Haiku","durationMs":1}"#)["Modellwahl"], "Start klein: Haiku")
        XCTAssertEqual(try rows(#"{"reason":"r","change":"upgrade","from":"Haiku","modelLabel":"Opus","durationMs":1}"#)["Modellwahl"], "Hochgestuft von Haiku auf Opus")
        XCTAssertEqual(try rows(#"{"reason":"r","change":"keep","modelLabel":"Haiku","durationMs":1}"#)["Modellwahl"], "Bleibt bei Haiku (Cache warm)")
        XCTAssertEqual(try rows(#"{"reason":"nur Grund","durationMs":1}"#)["Grund"], "nur Grund")
        XCTAssertNil(try rows(#"{"reason":"nur Grund","durationMs":1}"#)["Modellwahl"])
        let r = try rows(#"{"reason":"","durationMs":1}"#, extra: #","costUsd":"0.0123","cacheWriteTokens":200,"steps":3"#)
        XCTAssertEqual(r["Kosten"], "0,012 $")
        XCTAssertEqual(r["Cache geschrieben"], "200")
        XCTAssertEqual(r["Schritte"], "3")
        // Falscher Typ in einem Feld verwirft nicht die Metadaten.
        let bad = try dec(ChatMetadata.self, #"{"model":"m","jev":"kaputt","steps":{"a":1}}"#)
        XCTAssertEqual(bad.model, "m"); XCTAssertNil(bad.jev)
    }

    func testReplyMetadataAndCompactInfo() throws {
        let meta = try dec(ChatMetadata.self, #"{"replyTo":"old","replyQuote":{"role":"assistant","text":"Bezug"},"model":"Modell","inputTokens":10,"outputTokens":2}"#)
        XCTAssertEqual(meta.replyTo, "old")
        XCTAssertEqual(meta.replyQuote?.text, "Bezug")
        XCTAssertEqual(InfoText.compactRows(meta).map(\.0), ["Modell", "Dauer", "Tokens"])
        let body = ServiceClient.TurnBody(messages: [.init(id: "new", parts: [.init(text: "Frage")])], clientData: .init(model: "auto", effort: nil, context: true, botId: nil, skill: nil, modelPinned: nil), trigger: "submit-message", replyTo: "old")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        XCTAssertEqual(json["replyTo"] as? String, "old")
    }

    func testRemovedToolPartsStaySilent() {
        for name in ["memory_append", "memory_set", "brain_skills_list", "brain_skill_read", "save_skill", "memory_save", "memory_get", "memory_forget", "think_deep", "chat_recall", "unbekannt"] {
            for state in [ToolState.inputAvailable, .outputAvailable] {
                XCTAssertFalse(ToolPart(toolCallId: "t", name: name, state: state).isVisibleInChat, name)
            }
        }
    }
}

private struct FakeService: MemoryService {
    let box: Box
    final class Box: @unchecked Sendable {
        var deleted: [String] = []; var enabled = true; var failDelete = false; var failSwitch = false
        var heartbeat = false; var failHeartbeat = false; var edits: [String] = []; var restored: [String] = []
        var trash = [MemoryEntry(name: "alt")]; var failEdit = false
    }
    struct Boom: LocalizedError { var errorDescription: String? { "kaputt" } }
    func memory(botId: String) async throws -> MemoryList { MemoryList(entries: [MemoryEntry(name: "a"), MemoryEntry(name: "b")]) }
    func deleteMemory(botId: String, name: String) async throws { if box.failDelete { throw Boom() }; box.deleted.append(name) }
    func dreamer(botId: String) async throws -> DreamerState { DreamerState(enabled: box.enabled) }
    func setDreamer(botId: String, enabled: Bool) async throws -> Bool { if box.failSwitch { throw Boom() }; box.enabled = enabled; return enabled }
    func editMemory(botId: String, name: String, description: String, body: String, ifVersion: Int) async throws -> MemoryEntry? {
        if box.failEdit { throw Boom() }
        box.edits.append("\(name)|\(description)|\(body)|\(ifVersion)"); return nil
    }
    func memoryTrash(botId: String) async throws -> MemoryList { MemoryList(entries: box.trash) }
    func restoreMemory(botId: String, name: String) async throws { box.restored.append(name); box.trash.removeAll { $0.name == name } }
    func heartbeat(botId: String) async throws -> HeartbeatState { HeartbeatState(enabled: box.heartbeat) }
    func setHeartbeat(botId: String, enabled: Bool) async throws -> HeartbeatState {
        if box.failHeartbeat { throw Boom() }
        box.heartbeat = enabled; return HeartbeatState(enabled: enabled)
    }
}

@MainActor
final class MemoryModelTests: XCTestCase {
    func testDeleteRemovesEntryAndKeepsOnError() async {
        let box = FakeService.Box()
        let model = MemoryModel(botId: "b", service: FakeService(box: box))
        await model.load()
        XCTAssertEqual(model.entries.count, 2)
        let ok = await model.delete("a")
        XCTAssertTrue(ok)
        XCTAssertEqual(model.entries.map(\.name), ["b"])
        box.failDelete = true
        let failed = await model.delete("b")
        XCTAssertFalse(failed)
        XCTAssertEqual(model.entries.count, 1)
        XCTAssertEqual(model.error, "kaputt")
        _ = await model.delete("b")
        box.failDelete = false
        _ = await model.delete("b")
        XCTAssertTrue(model.isEmpty)
    }

    func testSwitchAndRevertOnError() async {
        let box = FakeService.Box()
        let model = MemoryModel(botId: "b", service: FakeService(box: box))
        await model.load()
        await model.setDreamer(false)
        XCTAssertEqual(model.dreamer?.enabled, false)
        XCTAssertFalse(box.enabled)
        box.failSwitch = true
        await model.setDreamer(true)
        XCTAssertEqual(model.dreamer?.enabled, false)
        XCTAssertEqual(model.dreamerError, "kaputt")
    }
}

@MainActor
final class MemoryPhase5Tests: XCTestCase {
    func testEditSendsSeenVersionAndRejectsEmptyText() async {
        let box = FakeService.Box()
        let model = MemoryModel(botId: "b", service: FakeService(box: box))
        await model.load()
        let entry = MemoryEntry(name: "tee", version: 4)
        let empty = await model.edit(entry, description: " ", body: "x")
        XCTAssertEqual(empty, "Beschreibung und Text dürfen nicht leer sein.")
        XCTAssertTrue(box.edits.isEmpty)
        let saved = await model.edit(entry, description: " Mag Tee ", body: " Nie Kaffee. ")
        XCTAssertNil(saved)
        XCTAssertEqual(box.edits, ["tee|Mag Tee|Nie Kaffee.|4"])
        box.failEdit = true
        let failed = await model.edit(entry, description: "a", body: "b")
        XCTAssertEqual(failed, "kaputt")
    }

    func testTrashLoadsAndRestoreRemovesIt() async {
        let box = FakeService.Box()
        let model = MemoryModel(botId: "b", service: FakeService(box: box))
        await model.load()
        XCTAssertEqual(model.trash.map(\.name), ["alt"])
        let restored = await model.restore("alt")
        XCTAssertNil(restored)
        XCTAssertEqual(box.restored, ["alt"])
        XCTAssertTrue(model.trash.isEmpty)
    }

    func testHeartbeatSwitchRevertsOnError() async {
        let box = FakeService.Box()
        let model = MemoryModel(botId: "b", service: FakeService(box: box))
        await model.load()
        XCTAssertEqual(model.heartbeat?.enabled, false)
        await model.setHeartbeat(true)
        XCTAssertEqual(model.heartbeat?.enabled, true)
        XCTAssertTrue(box.heartbeat)
        box.failHeartbeat = true
        await model.setHeartbeat(false)
        XCTAssertEqual(model.heartbeat?.enabled, true)
        XCTAssertEqual(model.heartbeatError, "kaputt")
    }
}
