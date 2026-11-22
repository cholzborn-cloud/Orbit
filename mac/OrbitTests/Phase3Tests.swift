import Network
import XCTest

// Phase 3 (Lauf B, korrigiert in Lauf D): Live-Zeile, Zwischennachrichten, Reaktionen, Dateikarten, Systemzeile, Onboarding.
final class Phase3Tests: XCTestCase {
    func testLibraryFileFiltersAndSearch() {
        let files = [("foto.png", "image/png"), ("bericht.pdf", "application/pdf"), ("Brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), ("notiz.txt", "text/plain"), ("archiv.zip", "application/zip")]
        func names(_ filter: String, _ query: String = "") -> [String] {
            files.filter { LibraryFileFilter.matches(filter, filename: $0.0, mediaType: $0.1, query: query) }.map(\.0)
        }
        XCTAssertEqual(names("Alle").count, 5)
        XCTAssertEqual(names("Bilder"), ["foto.png"])
        XCTAssertEqual(names("PDFs"), ["bericht.pdf"])
        XCTAssertEqual(names("Dokumente"), ["Brief.docx", "notiz.txt"])
        XCTAssertEqual(names("Dokumente", "BRIEF"), ["Brief.docx"])
    }

    private func decode(_ json: String) throws -> ChatMessage { try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8)) }
    private func data(_ json: String) -> Data { Data(json.utf8) }

    private func step(_ id: String, _ stateName: String, _ n: Int, chat: String = "c1", label: String = "Sucht im Web …") -> String {
        #"{"type":"status-step","chatId":"\#(chat)","botId":"b1","toolCallId":"\#(id)","tool":"web_search","label":"\#(label)","state":"\#(stateName)","step":\#(n),"at":1000}"#
    }

    // MARK: Statusleiste

    func testStatusStepStartsAndEnds() {
        var board = StepBoard()
        board.apply(line: data(step("t1", "start", 1)))
        XCTAssertEqual(board.current(forChat: "c1")?.label, "Sucht im Web …")
        board.apply(line: data(step("t1", "end", 1)))
        XCTAssertNil(board.current(forChat: "c1"))
    }

    func testLatestStartedStepWinsAndEndOfOlderOneKeepsIt() {
        var board = StepBoard()
        board.apply(line: data(step("t1", "start", 1, label: "Liest eine Datei …")))
        board.apply(line: data(step("t2", "start", 2, label: "Schreibt Notiz …")))
        XCTAssertEqual(board.current(forChat: "c1")?.label, "Schreibt Notiz …")
        board.apply(line: data(step("t1", "end", 2)))
        XCTAssertEqual(board.current(forChat: "c1")?.label, "Schreibt Notiz …")
        board.apply(line: data(step("t2", "end", 2)))
        XCTAssertNil(board.current(forChat: "c1"))
    }

    func testSnapshotCarriesStepsAndBrokenOnesAreSkipped() {
        var board = StepBoard()
        board.apply(line: data(step("old", "start", 1, chat: "c9")))
        board.apply(line: data(#"{"type":"snapshot","working":[],"approvals":[],"steps":[{"kaputt":1},\#(step("t1", "start", 3, chat: "c2", label: "Erstellt ein PDF …"))]}"#))
        XCTAssertNil(board.current(forChat: "c9"))
        XCTAssertEqual(board.current(forChat: "c2")?.label, "Erstellt ein PDF …")
        board.apply(line: data(#"{"type":"snapshot","working":[],"approvals":[]}"#))
        XCTAssertNil(board.current(forChat: "c2"))
    }

    func testTurnEndClearsStepsButWaitingKeepsThem() {
        var board = StepBoard()
        board.apply(line: data(step("t1", "start", 1)))
        board.apply(line: data(#"{"type":"status","chatId":"c1","botId":"b1","status":"wartet"}"#))
        XCTAssertNotNil(board.current(forChat: "c1"))
        board.apply(line: data(#"{"type":"status","chatId":"c1","botId":"b1","status":"fertig"}"#))
        XCTAssertNil(board.current(forChat: "c1"))
    }

    func testFallbackLabels() {
        XCTAssertEqual(LiveLabel.fallback(lastPart: nil), "Denkt nach …")
        XCTAssertEqual(LiveLabel.fallback(lastPart: .text("Hallo")), "Schreibt …")
        XCTAssertEqual(LiveLabel.fallback(lastPart: .reasoning("x")), "Denkt nach …")
        XCTAssertEqual(LiveLabel.fallback(lastPart: .tool(ToolPart(toolCallId: "t", name: "bash", state: .outputAvailable))), "Arbeitet …")
    }

    // MARK: Karten

    private let assistant = #"""
    {"id":"m1","role":"assistant","metadata":{"startedAt":1000,"finishedAt":13400},"parts":[
      {"type":"tool-say","toolCallId":"s1","state":"output-available","input":{"text":"Mach ich, ich schaue nach."},"output":{"ok":true,"at":1700000000000}},
      {"type":"tool-web_search","toolCallId":"t1","state":"output-available","input":{"query":"x"},"output":{"results":[]}},
      {"type":"tool-bash","toolCallId":"t2","state":"output-error","input":{"command":"ls"},"errorText":"kaputt"},
      {"type":"tool-react","toolCallId":"r1","state":"output-available","input":{"emoji":"👍"},"output":{"ok":true}},
      {"type":"tool-share_file","toolCallId":"auto-123","state":"output-available","input":{},"output":{"filename":"a.pdf","mediaType":"application/pdf","size":3,"data":"YWJj"}},
      {"type":"text","text":"Fertig."}]}
    """#

    func testOnlyApprovalAskAndFileCardsAreVisible() throws {
        let message = try decode(assistant)
        XCTAssertEqual(message.tools.filter(\.isVisibleInChat).map(\.name), ["share_file"])
        func tool(_ name: String, _ state: ToolState, output: JSONValue? = nil) -> ToolPart { ToolPart(toolCallId: "t", name: name, state: state, output: output) }
        XCTAssertTrue(tool("bash", .approvalRequested).isVisibleInChat)
        XCTAssertTrue(tool("ask_user", .inputAvailable).isVisibleInChat)
        XCTAssertFalse(tool("bash", .outputError).isVisibleInChat)
        XCTAssertFalse(tool("web_search", .outputAvailable, output: .object(["error": .string("x")])).isVisibleInChat)
        XCTAssertFalse(tool("web_search", .outputAvailable).isVisibleInChat)
        XCTAssertTrue(tool("create_pdf", .outputError).isVisibleInChat)
        XCTAssertFalse(tool("react", .approvalRequested).isVisibleInChat)
    }

    func testSayBecomesOwnBubbleWithTime() throws {
        let message = try decode(assistant)
        let say = try XCTUnwrap(message.tools.first)
        XCTAssertEqual(say.sayText, "Mach ich, ich schaue nach.")
        XCTAssertEqual(say.sayDate, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertFalse(say.isVisibleInChat)
        let empty = ToolPart(toolCallId: "s", name: "say", state: .outputAvailable, input: .object(["text": .string("  ")]))
        XCTAssertNil(empty.sayText)
        let failed = ToolPart(toolCallId: "s", name: "say", state: .outputAvailable, input: .object(["text": .string("Hi")]), output: .object(["ok": .bool(false)]))
        XCTAssertNil(failed.sayText)
    }

    func testReactOnlyMessageShowsNoRow() throws {
        let only = try decode(#"{"id":"m2","role":"assistant","parts":[{"type":"tool-react","toolCallId":"r","state":"output-available","input":{"emoji":"👍"},"output":{"ok":true}}]}"#)
        XCTAssertFalse(only.hasBubbleContent)
        XCTAssertTrue(only.tools.allSatisfy { $0.isReact })
        XCTAssertTrue(try decode(assistant).hasBubbleContent)
        let sayOnly = try decode(#"{"id":"m3","role":"assistant","parts":[{"type":"tool-say","toolCallId":"s","state":"input-available","input":{"text":"Moment"}}]}"#)
        XCTAssertTrue(sayOnly.hasBubbleContent)
    }

    func testStreamedSayPartsArrive() throws {
        var assembler = MessageAssembler()
        func chunk(_ json: String) throws -> StreamChunk { try JSONDecoder().decode(StreamChunk.self, from: Data(json.utf8)) }
        assembler.apply(try chunk(#"{"type":"start","messageId":"m9"}"#))
        assembler.apply(try chunk(#"{"type":"tool-input-available","toolCallId":"s1","toolName":"say","input":{"text":"Ich fange an."}}"#))
        XCTAssertEqual(assembler.message?.tools.first?.sayText, "Ich fange an.")
        assembler.apply(try chunk(#"{"type":"tool-output-available","toolCallId":"s1","output":{"ok":true,"at":5000}}"#))
        XCTAssertEqual(assembler.message?.tools.first?.sayDate, Date(timeIntervalSince1970: 5))
    }

    // Flackern am Ende eines Turns (04.11.2026): die Wiedergabe eines gespeicherten Turns beginnt mit einer leeren Nachricht derselben ID.
    // Die fertige Antwort bleibt stehen und wird erst durch die fertige Wiedergabe ersetzt; eine neue Antwort streamt wie bisher.
    func testReplayKeepsFinishedAnswerUntilDone() throws {
        func chunk(_ json: String) throws -> StreamChunk { try JSONDecoder().decode(StreamChunk.self, from: Data(json.utf8)) }
        var messages = [try JSONDecoder().decode(ChatMessage.self, from: data(#"{"id":"a1","role":"assistant","parts":[{"type":"text","text":"Fertig"}],"metadata":{"finishedAt":1}}"#))]
        var assembler = MessageAssembler()
        for json in [#"{"type":"start","messageId":"a1"}"#, #"{"type":"text-start","id":"t"}"#, #"{"type":"text-delta","id":"t","delta":"Fe"}"#] {
            if assembler.apply(try chunk(json)), let message = assembler.message { messages.upsert(message) }
            XCTAssertEqual(messages.map(\.text), ["Fertig"])
        }
        for json in [#"{"type":"text-delta","id":"t","delta":"rtig"}"#, #"{"type":"text-end","id":"t"}"#, #"{"type":"finish","messageMetadata":{"finishedAt":2}}"#] {
            if assembler.apply(try chunk(json)), let message = assembler.message { messages.upsert(message) }
        }
        XCTAssertEqual(messages.map(\.text), ["Fertig"])
        XCTAssertEqual(messages.first?.metadata?.finishedAt, 2)
        var fresh: [ChatMessage] = []
        var live = MessageAssembler()
        for json in [#"{"type":"start","messageId":"b1"}"#, #"{"type":"text-start","id":"t"}"#, #"{"type":"text-delta","id":"t","delta":"Hi"}"#] {
            if live.apply(try chunk(json)), let message = live.message { fresh.upsert(message) }
        }
        XCTAssertEqual(fresh.map(\.text), ["Hi"])
    }

    // MARK: Reaktionen

    func testHistoryDecodesReactionsLeniently() throws {
        let json = #"{"messages":[],"reactions":[{"messageId":"m1","actor":"user","emoji":"👍","createdAt":5},{"kaputt":true},{"messageId":"m1","actor":"b1","emoji":"❤️"}]}"#
        let response = try JSONDecoder().decode(MessagesResponse.self, from: data(json))
        XCTAssertEqual(response.reactions.count, 2)
        let old = try JSONDecoder().decode(MessagesResponse.self, from: data(#"{"messages":[]}"#))
        XCTAssertTrue(old.reactions.isEmpty)
    }

    func testReactionBoardReplacesPerActorAndGroups() {
        var board = ReactionBoard()
        board.set(messageId: "m1", actor: "user", emoji: "👍", at: 1)
        board.set(messageId: "m1", actor: "b1", emoji: "👍", at: 2)
        board.set(messageId: "m1", actor: "b2", emoji: "❤️", at: 3)
        XCTAssertEqual(board.groups(for: "m1").map(\.emoji), ["👍", "❤️"])
        XCTAssertEqual(board.groups(for: "m1").first?.count, 2)
        XCTAssertEqual(board.mine(for: "m1"), "👍")
        board.set(messageId: "m1", actor: "user", emoji: "🤔", at: 4)
        XCTAssertEqual(board.mine(for: "m1"), "🤔")
        XCTAssertEqual(board.reactions(for: "m1").count, 3)
        board.set(messageId: "m1", actor: "user", emoji: nil)
        XCTAssertNil(board.mine(for: "m1"))
        XCTAssertTrue(board.reactions(for: "m2").isEmpty)
    }

    func testReactionEventParsing() throws {
        let set = try XCTUnwrap(ReactionBoard.event(from: data(#"{"type":"reaction","chatId":"c1","messageId":"m1","actor":"b1","emoji":"✅"}"#)))
        XCTAssertEqual(set.emoji, "✅"); XCTAssertEqual(set.actor, "b1"); XCTAssertEqual(set.chatId, "c1")
        let removed = try XCTUnwrap(ReactionBoard.event(from: data(#"{"type":"reaction","chatId":"c1","messageId":"m1","actor":"user","emoji":null}"#)))
        XCTAssertNil(removed.emoji)
        XCTAssertNil(ReactionBoard.event(from: data(#"{"type":"status"}"#)))
        XCTAssertEqual(ReactionBoard.emojis, ["👍", "✅", "😂", "❤️", "👎", "🤔"])
    }

    // MARK: Dateikarten

    func testFileCardRules() {
        XCTAssertTrue(FileCardRules.canOpen(filename: "bericht.PDF"))
        XCTAssertTrue(FileCardRules.canOpen(filename: "notiz.md"))
        XCTAssertFalse(FileCardRules.canOpen(filename: "start.command"))
        XCTAssertFalse(FileCardRules.canOpen(filename: "skript.sh"))
        XCTAssertFalse(FileCardRules.canOpen(filename: "ohne-endung"))
        XCTAssertEqual(FileCardRules.kind(mediaType: "application/pdf", filename: "a.pdf"), "PDF")
        XCTAssertEqual(FileCardRules.kind(mediaType: "image/png", filename: "a.png"), "Bild")
        XCTAssertEqual(FileCardRules.safeName("../../etc/passwd"), "passwd")
        XCTAssertEqual(FileCardRules.safeName(".."), "Datei")
        XCTAssertEqual(FileCardRules.safeName(nil), "Datei")
    }

    func testAutoFileIsShareFileCardNotAStep() throws {
        let tool = try XCTUnwrap(try decode(assistant).tools.first { $0.isAutoFile })
        XCTAssertEqual(tool.name, "share_file")
        XCTAssertTrue(tool.isVisibleInChat)
    }

    // MARK: Onboarding

    func testOnboardingTurnBodyHasEmptyMessagesAndFlag() throws {
        let body = try JSONEncoder().encode(OnboardingTurnBody(model: "claude-sonnet-5-5", botId: "b1"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual((json["messages"] as? [Any])?.count, 0)
        let client = try XCTUnwrap(json["clientData"] as? [String: Any])
        XCTAssertEqual(client["onboarding"] as? Bool, true)
        XCTAssertEqual(client["botId"] as? String, "b1")
        XCTAssertEqual(client["model"] as? String, "claude-sonnet-5-5")
    }

    func testOnboardingEventAndBotFlag() throws {
        let event = try XCTUnwrap(OnboardingEvent.parse(data(#"{"type":"onboarding","botId":"b1","done":true,"instructions":true}"#)))
        XCTAssertEqual(event.botId, "b1"); XCTAssertTrue(event.done); XCTAssertTrue(event.instructions)
        XCTAssertNil(OnboardingEvent.parse(data(#"{"type":"reaction"}"#)))
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let bots = try decoder.decode(BotsResponse.self, from: data(#"""
        {"main":null,"groups":[],"bots":[{"chatId":"c","id":"b","name":"N","avatar":"erdi","color":null,"job":"j","instructions":null,"isMain":false,"look":null,"lastMessageAt":"2026-11-01T10:00:00Z","onboardingDone":false}]}
        """#))
        XCTAssertEqual(bots.bots.first?.onboardingDone, false)
    }

    // MARK: Lauf D: Werkzeuge unsichtbar, Systemzeile, Übergabe-Satz

    func testToolsAreNeverShownOnlyCardsSayAndFiles() throws {
        let message = try decode(assistant)
        // Sichtbar: say, Auto-Dateikarte, Text; bash und web_search nie.
        let shown = message.tools.filter { $0.sayText != nil || $0.isVisibleInChat }.map(\.name)
        XCTAssertEqual(shown, ["say", "share_file"])
        let failedTool = ToolPart(toolCallId: "t", name: "bash", state: .outputError, errorText: "kaputt")
        XCTAssertFalse(failedTool.isVisibleInChat)
        let onlyTools = try decode(#"{"id":"m5","role":"assistant","parts":[{"type":"tool-bash","toolCallId":"b","state":"output-available","input":{},"output":{}}]}"#)
        XCTAssertFalse(onlyTools.hasBubbleContent)
    }

    func testNoticeDecodingFromPartEventAndStream() throws {
        let stored = try decode(#"{"id":"n1","role":"assistant","parts":[{"type":"data-notice","data":{"text":"Versuche es erneut …","kind":"retry"}}]}"#)
        XCTAssertEqual(stored.notice, SystemNotice(text: "Versuche es erneut …", kind: .retry))
        XCTAssertFalse(stored.hasBubbleContent)
        XCTAssertFalse(stored.isSilent)
        let broken = try decode(#"{"id":"n2","role":"assistant","parts":[{"type":"data-notice","data":{"kind":"retry"}}]}"#)
        XCTAssertNil(broken.notice)
        XCTAssertNotNil(SystemNotice.event(from: data(#"{"type":"notice","chatId":"c1","text":"Bitte erlaube den Zugriff.","kind":"action"}"#)))
        XCTAssertNil(SystemNotice.event(from: data(#"{"type":"notice","chatId":"c1","text":"  "}"#)))
        XCTAssertEqual(SystemNotice(text: "x", kind: SystemNotice.kind("aktion")).isAlert, true)
        XCTAssertEqual(SystemNotice.kind("unbekannt"), .info)
        var assembler = MessageAssembler()
        func chunk(_ json: String) throws -> StreamChunk { try JSONDecoder().decode(StreamChunk.self, from: data(json)) }
        assembler.apply(try chunk(#"{"type":"start","messageId":"m1"}"#))
        assembler.apply(try chunk(#"{"type":"data-notice","data":{"text":"Versuche es erneut …","kind":"retry"}}"#))
        XCTAssertEqual(assembler.message?.notice?.text, "Versuche es erneut …")
    }

    func testNoticeBoardLifetime() {
        var board = NoticeBoard()
        board.apply(line: data(#"{"type":"notice","chatId":"c1","text":"Versuche es erneut …","kind":"retry"}"#))
        XCTAssertEqual(board.notice(forChat: "c1")?.kind, .retry)
        board.apply(line: data(#"{"type":"status","chatId":"c1","botId":"b","status":"arbeitet"}"#))
        XCTAssertNotNil(board.notice(forChat: "c1"))
        board.apply(line: data(#"{"type":"status","chatId":"c1","botId":"b","status":"fertig"}"#))
        XCTAssertNil(board.notice(forChat: "c1"))
        board.apply(line: data(#"{"type":"notice","chatId":"c1","text":"Bitte verbinde Google.","kind":"action"}"#))
        XCTAssertEqual(board.notice(forChat: "c1")?.isAlert, true)
        board.apply(line: data(#"{"type":"status","chatId":"c1","botId":"b","status":"ruhig"}"#))
        XCTAssertNil(board.notice(forChat: "c1"))
        XCTAssertTrue(OnboardingEvent.isOrbisCreated(data(#"{"type":"orbis-created","bots":[{"botId":"b","chatId":"c","name":"Nova"}]}"#)))
        XCTAssertFalse(OnboardingEvent.isOrbisCreated(data(#"{"type":"onboarding","botId":"b","done":true}"#)))
    }

    func testHandoffSentencesFollowFigma() {
        func line(_ kind: OrbiLine.Kind, _ direction: OrbiLine.Direction, _ status: OrbiLine.Status, held: Bool = false) -> OrbiLine.Phrase {
            OrbiLine(direction: direction, kind: kind, peer: .init(id: "n", name: "Nova", avatar: "erdi"), text: "x", held: held, status: status).phrase
        }
        XCTAssertEqual(line(.message, .out, .working), .init(prefix: "Nachricht gesendet an ", suffix: "", style: .shimmer))
        XCTAssertEqual(line(.message, .out, .working, held: true).style, .plain)
        // Consti 06.11.: kein „ist fertig“, kein „Antwort von“, auch für alte Zeilen.
        XCTAssertEqual(line(.message, .out, .waiting), .init(prefix: "Nachricht gesendet an ", suffix: "", style: .shimmer))
        XCTAssertEqual(line(.message, .out, .done), .init(prefix: "Nachricht gesendet an ", suffix: "", style: .plain))
        XCTAssertEqual(line(.message, .out, .failed), .init(prefix: "Nachricht an ", suffix: " fehlgeschlagen", style: .failure))
        XCTAssertEqual(line(.message, .in, .done), .init(prefix: "Nachricht von ", suffix: "", style: .plain))
        XCTAssertEqual(line(.reply, .in, .working), .init(prefix: "Nachricht von ", suffix: "", style: .plain))
        XCTAssertEqual(line(.reply, .in, .failed), .init(prefix: "Nachricht von ", suffix: " fehlgeschlagen", style: .failure))
        XCTAssertEqual(line(.reply, .out, .done), .init(prefix: "Nachricht gesendet an ", suffix: "", style: .plain))
        for kind in [OrbiLine.Kind.message, .reply] { for direction in [OrbiLine.Direction.in, .out] { for status in [OrbiLine.Status.done, .working, .waiting, .failed, .unclear] {
            let phrase = line(kind, direction, status)
            XCTAssertFalse((phrase.prefix + phrase.suffix).contains("fertig"))
            XCTAssertFalse((phrase.prefix + phrase.suffix).contains("Antwort"))
        } } }
    }

    func testSettingsIgnoreOldReplyLength() throws {
        let values = try JSONDecoder().decode(SettingsFull.self, from: data(#"{"settings":{"theme":"dark","replyLength":"long"}}"#))
        XCTAssertEqual(values.settings.theme, "dark")
    }

    func testFirstOrbiBecomesMain() {
        XCTAssertTrue(OnboardingRule.firstOrbiIsMain(existingOrbis: 0))
        XCTAssertFalse(OnboardingRule.firstOrbiIsMain(existingOrbis: 1))
    }

    func testReactionGroupsKeepOrderForPills() {
        var board = ReactionBoard()
        board.set(messageId: "m1", actor: "user", emoji: "👍", at: 1)
        board.set(messageId: "m1", actor: "b1", emoji: "👍", at: 2)
        board.set(messageId: "m1", actor: "b2", emoji: "👍", at: 3)
        let group = board.groups(for: "m1")[0]
        XCTAssertEqual(group.count, 3)
        XCTAssertEqual(group.names(bots: []), "dir, einem Orbi, einem Orbi")
    }
}

// Stopp-Knopf (04.11.2026): Offene Ströme dürfen den Stopp nicht blockieren. Mit URLSession.shared (6 Verbindungen je Host)
// wartete der Stopp hinter Ereignis- und Chat-Strömen. Echter lokaler Server, kein Stub: nur so zählt das Verbindungslimit.
final class StopPathTests: XCTestCase {
    func testStopReachesServiceWhileManyStreamsAreOpen() async throws {
        let server = try HangingServer()
        defer { server.cancel() }
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:\(try await server.port())")!, tokenOverride: { "test-token" })
        // Acht offene Ströme, wie bei mehreren arbeitenden Orbis plus Ereignisstrom.
        let streams = try (0..<8).map { index in
            let request = try client.attachRequest(chatId: "chat-\(index)")
            return Task { _ = try? await client.stream(request) { _ in } }
        }
        defer { streams.forEach { $0.cancel() } }
        try await Task.sleep(for: .milliseconds(300))
        let started = Date()
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await client.stop(chatId: "chat-0") }
            group.addTask { try await Task.sleep(for: .seconds(3)); throw URLError(.timedOut) }
            try await group.next()
            group.cancelAll()
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }
}

// Minimaler HTTP-Server: /stream bleibt offen (laufender Turn), /stop antwortet sofort.
private final class HangingServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "hanging-server")
    private var connections: [NWConnection] = []

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
    }

    func port() async throws -> UInt16 {
        for _ in 0..<50 {
            if let port = listener.port?.rawValue, port != 0 { return port }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw URLError(.cannotConnectToHost)
    }

    func cancel() {
        queue.sync { connections.forEach { $0.cancel() } }
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        connections.append(connection)
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, _, _ in
            let head = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if head.contains("/stream") {
                connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n".utf8), completion: .contentProcessed { _ in })
            } else {
                let body = #"{"stopped":true}"#
                let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
    }
}
