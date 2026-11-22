import XCTest

@MainActor
final class CardPhaseTests: XCTestCase {
    private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    private func approvalTool(_ state: ToolState = .approvalRequested, id: String? = "a1") -> ToolPart {
        ToolPart(toolCallId: "t", name: "bash", state: state, input: json(#"{"command":"ls"}"#), approvalId: id)
    }

    private func board(_ lines: [String]) -> InteractionBoard {
        var board = InteractionBoard()
        for line in lines { board.apply(line: Data(line.utf8)) }
        return board
    }

    private let pendingLine = #"{"type":"approval","status":"pending","id":"a1","kind":"approval","chatId":"c","botId":"b","toolCallId":"t","tool":"bash","input":{},"requestedAt":1000000,"expiresAt":87400000}"#

    func testApprovalOpenWithDeadlineThenExpired() {
        let board = board([pendingLine])
        let before = Date(timeIntervalSince1970: 1100)
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: board, live: true, now: before), .open(expiresAt: Date(timeIntervalSince1970: 87400)))
        // Die Anzeige verfällt von selbst, auch wenn das Ereignis noch nicht da ist.
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: board, live: true, now: Date(timeIntervalSince1970: 87400)), .expired)
    }

    func testApprovalResolvedStatesAndUnknown() {
        let expired = board([pendingLine, pendingLine.replacingOccurrences(of: #""status":"pending""#, with: #""status":"expired""#)])
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: expired, live: true, now: .now), .expired)
        // Nach dem Verfall steht die Karte auch dann als „abgelaufen“, wenn der Dienst das Werkzeug schon abgelehnt hat.
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(.outputDenied), board: expired, live: false, now: .now), .expired)
        let denied = board([pendingLine, pendingLine.replacingOccurrences(of: #""status":"pending""#, with: #""status":"denied""#)])
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: denied, live: true, now: .now), .decided(approved: false))
        // „Immer erlauben“ kommt als always im Ereignis an; die Karte zeigt dann „Immer erlaubt“.
        let once = board([pendingLine, pendingLine.replacingOccurrences(of: #""status":"pending""#, with: #""status":"approved""#)])
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: once, live: true, now: .now), .decided(approved: true, always: false))
        let always = board([pendingLine, pendingLine.replacingOccurrences(of: #""status":"pending""#, with: #""status":"approved","always":true"#)])
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: always, live: true, now: .now), .decided(approved: true, always: true))
        // Unbekannt: läuft der Turn, bleibt die Karte bedienbar (Ereignis kommt gleich), sonst „nicht mehr offen“.
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: InteractionBoard(), live: true, now: .now), .open(expiresAt: nil))
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(), board: InteractionBoard(), live: false, now: .now), .gone)
        XCTAssertEqual(ApprovalPhase.resolve(tool: approvalTool(.outputAvailable), board: InteractionBoard(), live: false, now: .now), .gone)
    }

    func testWaitTextAndReasons() {
        XCTAssertEqual(ApprovalClock.waitText, "Wartet bis zu 24 Stunden auf dich")
        XCTAssertEqual(ApprovalReason.label("loeschen"), "Endgültig löschen")
        XCTAssertEqual(ApprovalReason.label("system"), "Systemeingriff")
        XCTAssertNil(ApprovalReason.label(nil))
        XCTAssertFalse(ApprovalReason.allowsAlways("geheimnis"))
        XCTAssertTrue(ApprovalReason.allowsAlways("geld"))
        XCTAssertTrue(ApprovalReason.allowsAlways(nil))
    }

    func testDauerhaftReasonDecodesWithDetail() throws {
        let line = pendingLine.replacingOccurrences(of: #""input":{}"#, with: #""input":{},"reason":"dauerhaft","text":"Titel","detail":"Name: A\nPlan: täglich\nAufgabe (wörtlich):\nTu es""#)
        let card = try JSONDecoder().decode(PendingInteraction.self, from: Data(line.utf8))
        XCTAssertEqual(card.reason, "dauerhaft")
        XCTAssertEqual(card.detail, "Name: A\nPlan: täglich\nAufgabe (wörtlich):\nTu es")
        XCTAssertEqual(ApprovalReason.label("dauerhaft"), "Dauerhafte Änderung")
        XCTAssertTrue(ApprovalReason.allowsAlways(card.reason))
        XCTAssertEqual(board([line]).pending["a1"]?.reason, "dauerhaft")
    }

    func testUnknownReasonFallsBackToSystemAndDetailIsOptional() throws {
        let line = pendingLine.replacingOccurrences(of: #""input":{}"#, with: #""input":{},"reason":"zukunft""#)
        let card = try JSONDecoder().decode(PendingInteraction.self, from: Data(line.utf8))
        XCTAssertEqual(card.reason, "system")
        XCTAssertNil(card.detail)
        XCTAssertNil(try JSONDecoder().decode(PendingInteraction.self, from: Data(pendingLine.utf8)).reason)
        XCTAssertEqual(ApprovalReason.normalized("geld"), "geld")
        XCTAssertTrue(ApprovalReason.allowsAlways(card.reason))
    }

    private func handoff(_ state: ToolState, preliminary: Bool, output: String) -> (ToolPart, HandoffInfo) {
        let tool = ToolPart(toolCallId: "h", name: "handoff", state: state, input: json(#"{"task":"x"}"#), output: json(output), preliminary: preliminary)
        return (tool, HandoffInfo(tool))
    }

    func testHandoffPhases() {
        let waiting = handoff(.outputAvailable, preliminary: true, output: #"{"to":"Zeno","task":"x","waiting":true}"#)
        XCTAssertEqual(HandoffPhase.make(tool: waiting.0, info: waiting.1, live: true).kind, .waiting)
        let running = handoff(.outputAvailable, preliminary: true, output: #"{"to":"Zeno","task":"x","message":{"id":"m","role":"assistant","parts":[{"type":"tool-write_file","toolCallId":"w","state":"input-available","input":{}}]}}"#)
        let phase = HandoffPhase.make(tool: running.0, info: running.1, live: true)
        XCTAssertEqual(phase.kind, .running); XCTAssertEqual(phase.step, "schreibt Datei …")
        // Das Ereignis „wartet“ gilt auch ohne Hinweis in der Ausgabe.
        let done = handoff(.outputAvailable, preliminary: false, output: #"{"to":"Zeno","task":"x","message":{"id":"m","role":"assistant","parts":[{"type":"text","text":"Fertig."}]}}"#)
        XCTAssertEqual(HandoffPhase.make(tool: done.0, info: done.1, live: false).kind, .finished)
        // Ein altes Fehler-Ereignis macht eine fertige Karte nicht kaputt.
        let empty = handoff(.outputAvailable, preliminary: false, output: #"{"to":"Zeno","task":"x"}"#)
        XCTAssertEqual(HandoffPhase.make(tool: empty.0, info: empty.1, live: false).error, "Keine Antwort erhalten.")
        // Stopp mitten im Lauf: der Turn ist weg, die Karte steht auf „Unterbrochen.“
        let stopped = HandoffPhase.make(tool: running.0, info: running.1, live: false)
        XCTAssertEqual(stopped.kind, .failed); XCTAssertEqual(stopped.error, "Unterbrochen.")
        let failed = handoff(.outputAvailable, preliminary: false, output: #"{"to":"Zeno","task":"x","error":"Zeno hat nicht geantwortet."}"#)
        XCTAssertEqual(HandoffPhase.make(tool: failed.0, info: failed.1, live: true).kind, .failed)
    }

    func testAskPanelSingleMultipleAndCustom() {
        let single = AskQuestion(question: "Farbe?", options: [AskOption(label: "Rot", description: nil, recommended: false), AskOption(label: "Blau", description: nil, recommended: true), AskOption(label: "Grün", description: nil, recommended: false)], multiple: false)
        let multi = AskQuestion(question: "Formen?", options: [AskOption(label: "Kreis", description: nil, recommended: true), AskOption(label: "Dreieck", description: nil, recommended: false)], multiple: true)
        let panel = AskPanelModel(questions: [single, multi])
        XCTAssertEqual(panel.buttonTitle, "Überspringen")
        panel.choose(number: 2)
        XCTAssertEqual(panel.choice, ["Blau"]); XCTAssertEqual(panel.buttonTitle, "Weiter")
        // Einfachauswahl: die eigene Antwort ersetzt die Wahl.
        panel.custom = "Lila"; panel.customChanged()
        XCTAssertEqual(panel.choice, ["Lila"]); XCTAssertFalse(panel.isPicked("Blau"))
        XCTAssertNil(panel.advance()); XCTAssertEqual(panel.page, 1)
        // Mehrfachauswahl: Wahl plus eigene Antwort, ohne Doppelte.
        panel.choose("Kreis"); panel.custom = "Kreis"
        XCTAssertEqual(panel.choice, ["Kreis"])
        panel.custom = "Stern"
        XCTAssertEqual(panel.choice, ["Kreis", "Stern"]); XCTAssertEqual(panel.buttonTitle, "Senden (2)")
        panel.choose("Kreis"); panel.choose("Dreieck")
        XCTAssertEqual(panel.choice, ["Dreieck", "Stern"])
        let result = panel.advance()
        XCTAssertEqual(result, [QuestionAnswer(question: "Farbe?", answers: ["Lila"]), QuestionAnswer(question: "Formen?", answers: ["Dreieck", "Stern"])])
    }

    func testAskPanelSkippedPageAndNumberKeys() {
        let q = AskQuestion(question: "A?", options: [AskOption(label: "Ja", description: nil, recommended: true), AskOption(label: "Nein", description: nil, recommended: false), AskOption(label: "Vielleicht", description: nil, recommended: false)], multiple: false)
        let panel = AskPanelModel(questions: [q, q])
        XCTAssertNil(panel.advance(), "ohne Wahl überspringt Weiter die Seite")
        panel.choose(number: 9)
        XCTAssertEqual(panel.choice, [], "unbekannte Nummer wird ignoriert")
        panel.choose(number: 3)
        XCTAssertEqual(panel.advance()?.map(\.answers), [[], ["Vielleicht"]])
    }

    func testSingleChoiceAdvancesAndMultipleWaits() {
        let one = AskQuestion(question: "Farbe?", options: [AskOption(label: "Blau", description: nil, recommended: false)], multiple: false)
        let many = AskQuestion(question: "Form?", options: [AskOption(label: "Kreis", description: nil, recommended: false)], multiple: true)
        let panel = AskPanelModel(questions: [one, many, one])
        XCTAssertNil(panel.select(number: 1)); XCTAssertEqual(panel.page, 1)
        XCTAssertNil(panel.select("Kreis")); XCTAssertEqual(panel.page, 1)
        XCTAssertNil(panel.advance()); XCTAssertEqual(panel.page, 2)
        XCTAssertEqual(panel.select("Blau")?.map(\.answers), [["Blau"], ["Kreis"], ["Blau"]])
    }

    func testOrbiSelectionDisablesCustomInputWithoutChangingOrdinaryQuestions() {
        let body = #"{"onboardingOrbiSelection":true,"questions":[{"question":"Welche Orbis soll ich anlegen?","multiple":true,"options":[{"label":"Lernhilfe","description":"Lernen"},{"label":"Planer","description":"Planen"}]}]}"#
        let special = ToolPart(toolCallId: "q", name: "ask_user", state: .inputAvailable, input: json(body))
        let questions = special.askQuestions
        XCTAssertEqual(questions.count, 1)
        XCTAssertFalse(questions[0].allowsCustom)
        let panel = AskPanelModel(questions: questions)
        panel.choose("Lernhilfe")
        panel.custom = "Unbekannt"
        XCTAssertEqual(panel.choice, ["Lernhilfe"])
        XCTAssertEqual(panel.advance()?.first?.answers, ["Lernhilfe"])
        let ordinary = ToolPart(toolCallId: "n", name: "ask_user", state: .inputAvailable, input: json(body.replacingOccurrences(of: #""onboardingOrbiSelection":true,"#, with: "")))
        XCTAssertTrue(ordinary.askQuestions[0].allowsCustom)
        let ordinaryPanel = AskPanelModel(questions: ordinary.askQuestions)
        ordinaryPanel.custom = "Eigene Antwort"
        XCTAssertEqual(ordinaryPanel.choice, ["Eigene Antwort"])
    }

    func testTokenLine() {
        XCTAssertEqual(TokenText.line(input: 1234, cached: 1000, output: 56), "Eingabe 1.234 (Cache 1.000) · Ausgabe 56")
        XCTAssertEqual(TokenText.line(input: 10, cached: nil, output: nil), "Eingabe 10 · Ausgabe –")
    }
}
