import XCTest

final class CardModelTests: XCTestCase {
    private func chunk(_ json: String) -> StreamChunk { try! JSONDecoder().decode(StreamChunk.self, from: Data(json.utf8)) }

    private func assemble(_ lines: [String]) -> MessageAssembler {
        var assembler = MessageAssembler()
        for line in lines { assembler.apply(chunk(line)) }
        return assembler
    }


    private func firstTool(_ assembler: MessageAssembler) -> ToolPart? {
        for part in assembler.message?.parts ?? [] { if case .tool(let tool) = part { return tool } }
        return nil
    }

    func testApprovalResponseWithoutToolCallIdFindsTheTool() {
        // Der Dienst sendet die Antwort nur mit approvalId (turn.ts): ohne Zuordnung bliebe die Karte offen.
        let a = assemble([
            #"{"type":"start","messageId":"m1"}"#,
            #"{"type":"tool-input-available","toolCallId":"t1","toolName":"bash","input":{"command":"echo hi"}}"#,
            #"{"type":"tool-approval-request","approvalId":"a1","toolCallId":"t1"}"#,
        ])
        XCTAssertEqual(firstTool(a)?.state, .approvalRequested)
        XCTAssertEqual(firstTool(a)?.approvalId, "a1")
        var b = a
        b.apply(chunk(#"{"type":"tool-approval-response","approvalId":"a1","approved":true}"#))
        XCTAssertEqual(firstTool(b)?.state, .approvalResponded)
        var c = a
        c.apply(chunk(#"{"type":"tool-approval-response","approvalId":"a1","approved":false}"#))
        XCTAssertEqual(firstTool(c)?.state, .outputDenied)
    }

    func testInputAndOutputSurvive() {
        let a = assemble([
            #"{"type":"start"}"#,
            #"{"type":"tool-input-start","toolCallId":"t1","toolName":"web_search"}"#,
            #"{"type":"tool-input-available","toolCallId":"t1","toolName":"web_search","input":{"query":"Hono"}}"#,
            #"{"type":"tool-output-available","toolCallId":"t1","output":{"answer":"Kurz.","sources":[{"title":"Hono","url":"https://hono.dev/docs"},{"title":"Böse","url":"javascript:alert(1)"}]}}"#,
        ])
        let tool = firstTool(a)!
        XCTAssertEqual(tool.state, .outputAvailable)
        let info = WebSearchInfo(tool)
        XCTAssertEqual(info.query, "Hono")
        XCTAssertEqual(info.sources.count, 1, "nur http/https")
        XCTAssertEqual(info.sources.first?.domain, "hono.dev")
    }

    func testPreliminaryHandoffThenFinal() {
        let a = assemble([
            #"{"type":"start"}"#,
            #"{"type":"tool-input-available","toolCallId":"h1","toolName":"handoff","input":{"task":"Rechne 3+4"}}"#,
            ##"{"type":"tool-output-available","toolCallId":"h1","preliminary":true,"output":{"to":"Zeno","avatar":"erdi","color":"#336699","task":"Rechne 3+4","waiting":true}}"##,
        ])
        var tool = firstTool(a)!
        XCTAssertTrue(tool.preliminary)
        XCTAssertTrue(HandoffInfo(tool).waiting)
        var b = a
        b.apply(chunk(##"{"type":"tool-output-available","toolCallId":"h1","preliminary":true,"output":{"to":"Zeno","avatar":"erdi","color":"#336699","task":"Rechne 3+4","message":{"id":"x","role":"assistant","parts":[{"type":"tool-bash","toolCallId":"b1","state":"approval-requested","input":{"command":"ls"},"approval":{"id":"ap9"}},{"type":"text","text":"Es sind 7."}]}}}"##))
        tool = firstTool(b)!
        let info = HandoffInfo(tool)
        XCTAssertEqual(info.parts.count, 2)
        XCTAssertTrue(info.hasPendingApproval)
        XCTAssertEqual(info.answer, "Es sind 7.")
        if case .tool(let nested) = info.parts[0] { XCTAssertEqual(nested.approvalId, "ap9") } else { XCTFail("verschachtelte Freigabe fehlt") }
        b.apply(chunk(#"{"type":"tool-output-available","toolCallId":"h1","output":{"to":"Zeno","avatar":"erdi","color":null,"task":"Rechne 3+4"}}"#))
        XCTAssertFalse(firstTool(b)!.preliminary)
    }

    func testReplayStartResetsAndErrorKeepsText() {
        var a = assemble([#"{"type":"start","messageId":"m1"}"#, #"{"type":"text-start","id":"x"}"#, #"{"type":"text-delta","id":"x","delta":"Hallo"}"#])
        XCTAssertEqual(a.message?.text, "Hallo")
        a.apply(chunk(#"{"type":"start","messageId":"m1"}"#))
        XCTAssertEqual(a.message?.parts.count, 0, "Wiedergabe beginnt von vorn")
        a.apply(chunk(#"{"type":"error","errorText":"boom"}"#))
        XCTAssertEqual(a.errorText, "boom")
    }

    func testPersistedPartDecodesInputOutputApproval() throws {
        let json = #"{"id":"m","role":"assistant","parts":[{"type":"tool-ask_user","toolCallId":"q1","state":"output-available","input":{"questions":[{"question":"Welche Farbe?","options":[{"label":"Rot","recommended":true},{"label":"Blau"},{"label":"Grün"}]}]},"output":{"answers":[{"question":"Welche Farbe?","answers":["Rot"]}]}}],"metadata":{"botId":"b","jev":{"kind":"route","reason":"klein","durationMs":470,"source":"jev","modelLabel":"Haiku 5.5"}}}"#
        let message = try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
        guard case .tool(let tool) = message.parts[0] else { return XCTFail() }
        XCTAssertEqual(tool.askQuestions.first?.options.count, 3)
        XCTAssertEqual(tool.askQuestions.first?.options.first?.recommended, true)
        XCTAssertEqual(tool.askResult?.answers.first?.answers, ["Rot"])
        XCTAssertEqual(message.metadata?.jev?.modelLabel, "Haiku 5.5")
    }

    func testRedactionAndConnectorLabel() {
        let value = try! JSONDecoder().decode(JSONValue.self, from: Data(#"{"url":"x","apiToken":"geheim","nested":{"Password":"p"}}"#.utf8))
        let text = value.prettyRedacted()
        XCTAssertFalse(text.contains("geheim")); XCTAssertFalse(text.contains("\"p\""))
        XCTAssertTrue(text.contains("•••"))
        XCTAssertEqual(ToolText.label("connector_deepwiki__read_wiki_structure"), "read_wiki_structure (Konnektor)")
        XCTAssertEqual(ToolText.label("bash"), "bash")
    }

    func testInteractionBoardSnapshotEventsAndExpiry() {
        var board = InteractionBoard()
        let item = #"{"id":"a1","kind":"approval","chatId":"c","botId":"b","toolCallId":"t","tool":"bash","input":{"command":"ls"},"requestedAt":1000000,"expiresAt":87400000,"reason":"nachricht","approvalKind":"nachricht","text":"Trixi möchte eine Mail senden.""#
        board.apply(line: Data((#"{"type":"snapshot","approvals":[\#(item)}],"working":[],"automations":[]}"#).utf8))
        XCTAssertEqual(board.pending["a1"]?.tool, "bash")
        XCTAssertEqual(board.pending["a1"]?.expiresAt.timeIntervalSince1970, 87400)
        XCTAssertEqual(board.pending["a1"]?.reason, "nachricht")
        XCTAssertEqual(board.pending["a1"]?.text, "Trixi möchte eine Mail senden.")
        board.apply(line: Data((#"{"type":"approval","status":"expired",\#(item.dropFirst())}"#).utf8))
        XCTAssertNil(board.pending["a1"])
        XCTAssertEqual(board.resolved["a1"], "expired")
        // Das alte Ereignis `handoff` wird nicht mehr gelesen und ändert nichts.
        let before = board
        board.apply(line: Data(#"{"type":"handoff","chatId":"c","botId":"b","handoffId":"h","to":"z","status":"running"}"#.utf8))
        XCTAssertEqual(board, before)
        board.apply(line: Data("kaputt".utf8))
        XCTAssertEqual(board, before)
    }

    func testQuestionPendingByToolCallId() {
        var board = InteractionBoard()
        board.apply(line: Data(#"{"type":"question","status":"pending","id":"q1","kind":"ask","chatId":"c","botId":"b","toolCallId":"q1","tool":"ask_user","input":{},"requestedAt":0,"expiresAt":600000}"#.utf8))
        XCTAssertNotNil(board.question(toolCallId: "q1"))
    }

    func testErrorTextTranslates() {
        XCTAssertEqual(ErrorText.translate("Error: 429 Too many requests").text, "Das Modell ist gerade pausiert. Warte kurz oder wähle ein anderes Modell.")
        XCTAssertEqual(ErrorText.translate("connection refused").text, "Der Dienst ist nicht erreichbar. Läuft er auf diesem Mac?")
        XCTAssertEqual(ErrorText.translate("etwas anderes").detail, nil)
        XCTAssertEqual(ErrorText.translate("").text, "Die Antwort ist fehlgeschlagen.")
        XCTAssertNil(ErrorText.translate("Datei forbidden_words.txt fehlt").detail, "forbidden in Namen zählt nicht")
    }
}
