import XCTest

// Zeilen „Nachricht gesendet an/von @Orbi“ (Phase 2): Dekodieren, Texte, Status, Stille Antworten.
final class OrbiLineTests: XCTestCase {
    func testLiveLineFigureFollowsStateWithoutAnimatingQueuedWork() {
        let peer = OrbiLine.Peer(id: "b", name: "Nova", avatar: "nova", color: nil)
        func line(_ status: OrbiLine.Status, held: Bool = false, queued: Bool = false) -> OrbiLine {
            OrbiLine(direction: .out, kind: .message, peer: peer, text: "Hallo", held: held, queued: queued, status: status)
        }
        XCTAssertEqual(line(.working).figureState, .working)
        XCTAssertEqual(line(.waiting).figureState, .waiting)
        XCTAssertEqual(line(.working, held: true).figureState, .calm)
        XCTAssertEqual(line(.working, queued: true).figureState, .calm)
        XCTAssertEqual(line(.done).figureState, .calm)
    }
    private func messages(_ json: String) throws -> [ChatMessage] {
        try JSONDecoder().decode(MessagesResponse.self, from: Data(json.utf8)).messages
    }

    private func lineJSON(direction: String, kind: String, status: String, extra: String = "") -> String {
        """
        {"messages":[{"id":"l1","role":"\(direction == "out" ? "assistant" : "user")","metadata":{"kind":"orbi-line","rootTaskId":"t"},
        "parts":[{"type":"data-orbi-message","data":{"v":1,"linkId":"k","direction":"\(direction)","kind":"\(kind)",
        "peer":{"id":"b1","name":"Nova","avatar":"nova","color":"#55b6c3"},"text":"Rechne 3 + 4","priority":true,"status":"\(status)"\(extra)}}]}]}
        """
    }

    func testDecodesOutgoingLine() throws {
        let message = try XCTUnwrap(messages(lineJSON(direction: "out", kind: "message", status: "arbeitet")).first)
        let line = try XCTUnwrap(message.orbiLine)
        XCTAssertTrue(message.isLine)
        XCTAssertEqual(line.peer.id, "b1")
        XCTAssertEqual(line.peer.name, "Nova")
        XCTAssertEqual(line.title, "Nachricht gesendet an")
        XCTAssertEqual(line.statusText, "arbeitet")
        XCTAssertEqual(message.metadata?.kind, "orbi-line")
        XCTAssertTrue(message.text.isEmpty)
    }

    // Consti 06.11.: Nachricht und Antwort desselben Orbis direkt hintereinander ergeben nur eine Zeile „Nachricht von …“.
    func testRepeatedIncomingLineIsHidden() throws {
        func one(_ id: String, _ kind: String, _ direction: String = "in") throws -> ChatMessage {
            try XCTUnwrap(messages(lineJSON(direction: direction, kind: kind, status: "fertig").replacingOccurrences(of: #""id":"l1""#, with: #""id":"\#(id)""#)).first)
        }
        let list = [try one("a", "message"), try one("b", "reply"), try one("c", "message", "out"), try one("d", "reply")]
        XCTAssertEqual(OrbiLine.repeatedIds(in: list), ["b"])
    }

    func testTitlesForAllFourDirections() throws {
        func title(_ direction: String, _ kind: String) throws -> String {
            try XCTUnwrap(messages(lineJSON(direction: direction, kind: kind, status: "fertig")).first?.orbiLine).title
        }
        XCTAssertEqual(try title("out", "message"), "Nachricht gesendet an")
        XCTAssertEqual(try title("in", "message"), "Nachricht von")
        XCTAssertEqual(try title("out", "reply"), "Nachricht gesendet an")
        XCTAssertEqual(try title("in", "reply"), "Nachricht von")
    }

    func testStatusTexts() throws {
        func status(_ status: String, _ extra: String = "") throws -> OrbiLine {
            try XCTUnwrap(messages(lineJSON(direction: "in", kind: "message", status: status, extra: extra)).first?.orbiLine)
        }
        XCTAssertEqual(try status("wartet").statusText, "wartet auf dich")
        XCTAssertEqual(try status("fertig").statusText, "fertig")
        XCTAssertEqual(try status("fehlgeschlagen").statusText, "fehlgeschlagen")
        XCTAssertTrue(try status("fehlgeschlagen").isFailure)
        XCTAssertEqual(try status("unklar").statusText, "unklar")
        XCTAssertEqual(try status("irgendwas").statusText, "unklar")
        XCTAssertEqual(try status("arbeitet", #","held":true"#).statusText, "gehalten")
        XCTAssertEqual(try status("arbeitet", #","queued":true"#).statusText, "in der Warteschlange")
        // Ein Endstatus gewinnt gegen ein altes `queued`.
        XCTAssertEqual(try status("fertig", #","queued":true"#).statusText, "fertig")
    }

    func testBrokenDataBecomesUnknownPartNotAnError() throws {
        let broken = #"{"messages":[{"id":"x","role":"assistant","parts":[{"type":"data-orbi-message"},{"type":"data-orbi-message","data":"kaputt"},{"type":"data-etwas-neues","data":{}},{"type":"text","text":"Hallo"}]}]}"#
        let message = try XCTUnwrap(messages(broken).first)
        XCTAssertNil(message.orbiLine)
        XCTAssertEqual(message.text, "Hallo")
        XCTAssertEqual(message.parts.count, 4)
    }

    func testMissingFieldsGetDefaults() throws {
        let sparse = #"{"messages":[{"id":"x","role":"user","parts":[{"type":"data-orbi-message","data":{"peer":{"id":"g1","name":"Team","avatar":""}}}]}]}"#
        let line = try XCTUnwrap(messages(sparse).first?.orbiLine)
        XCTAssertTrue(line.peer.isGroup)
        XCTAssertEqual(line.status, .unclear)
        XCTAssertEqual(line.text, "")
    }

    func testLongTextIsTruncatedForDisplay() {
        let peer = OrbiLine.Peer(id: "b", name: "Nova", avatar: "nova", color: nil)
        let long = OrbiLine(direction: .in, kind: .reply, peer: peer, text: String(repeating: "a", count: 3000), status: .done)
        XCTAssertLessThanOrEqual(long.displayText.count, OrbiLine.maxDisplayCharacters + 2)
        XCTAssertTrue(long.displayText.hasSuffix("…"))
        let short = OrbiLine(direction: .in, kind: .reply, peer: peer, text: "kurz", status: .done)
        XCTAssertEqual(short.displayText, "kurz")
    }

    func testSilentGroupReplyShowsNoBubble() throws {
        // Erste Gruppen-Nachricht eines Sprechers, der schweigt: kein Text, nur Denken.
        let silent = try XCTUnwrap(messages(#"{"messages":[{"id":"s","role":"assistant","parts":[{"type":"reasoning","text":"…"},{"type":"text","text":"  "}]}]}"#).first)
        XCTAssertTrue(silent.isSilent)
        let empty = try XCTUnwrap(messages(#"{"messages":[{"id":"e","role":"assistant","parts":[]}]}"#).first)
        XCTAssertTrue(empty.isSilent)
        let spoken = try XCTUnwrap(messages(#"{"messages":[{"id":"t","role":"assistant","parts":[{"type":"text","text":"Hi"}]}]}"#).first)
        XCTAssertFalse(spoken.isSilent)
        let line = try XCTUnwrap(messages(lineJSON(direction: "out", kind: "message", status: "fertig")).first)
        XCTAssertFalse(line.isSilent)
    }

    func testBlankTextBeforeToolShowsNoEmptyBubble() throws {
        // Echter Fall (Chat vom 02.11.): „\n“ vor brain_search, danach die Antwort. Nur die Antwort ist eine Blase.
        let json = #"{"messages":[{"id":"a","role":"assistant","parts":[{"type":"step-start"},{"type":"text","text":"\n"},{"type":"tool-brain_search","toolCallId":"b","state":"output-available","input":{"query":"x"},"output":{"hits":[]}},{"type":"step-start"},{"type":"text","text":"Ich habe nichts umbenannt."}]}]}"#
        let answer = try XCTUnwrap(messages(json).first)
        XCTAssertEqual(answer.answerParts(botId: nil).map(\.offset), [4])
        XCTAssertEqual(Array(answer.bubbleParts.keys), [4])
        XCTAssertEqual(answer.bubbleParts[4], "a~t1", "Schlüssel zählt weiter alle Text-Teile wie der Dienst")
        XCTAssertTrue(answer.hasBubbleContent)

        // Weck-Turn ohne Text: nur ein Werkzeug und eine Leerzeile. Keine Zeile, keine Blase.
        let quiet = #"{"messages":[{"id":"q","role":"assistant","parts":[{"type":"step-start"},{"type":"text","text":" \n\n"},{"type":"tool-brain_search","toolCallId":"b","state":"output-available","input":{"query":"x"},"output":{"hits":[]}}]}]}"#
        let woken = try XCTUnwrap(messages(quiet).first)
        XCTAssertFalse(woken.hasBubbleContent)
        XCTAssertTrue(woken.answerParts(botId: nil).isEmpty)
        XCTAssertTrue(woken.bubbleParts.isEmpty)
    }

    func testOldHandoffToolPartStaysReadable() throws {
        let old = #"{"messages":[{"id":"h","role":"assistant","parts":[{"type":"tool-handoff","toolCallId":"c","state":"output-available","input":{"task":"x"},"output":{"to":"Zeno","task":"x","message":{"id":"m","role":"assistant","parts":[{"type":"text","text":"Fertig."}]}}}]}]}"#
        let message = try XCTUnwrap(messages(old).first)
        guard case .tool(let tool) = message.parts[0] else { return XCTFail("kein Werkzeugteil") }
        XCTAssertEqual(tool.name, "handoff")
        XCTAssertEqual(HandoffInfo(tool).answer, "Fertig.")
        XCTAssertFalse(message.isSilent)
    }
}
