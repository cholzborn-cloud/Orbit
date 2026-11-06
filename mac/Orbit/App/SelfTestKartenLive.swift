import AppKit
import Foundation

// Live-Prüfung der Karten gegen den Dienst der Datenbankkopie (nur frisch angelegte Test-Orbis mit Platzhalter-Sandbox).
// Die Modelle antworten nicht deterministisch: jeder Schritt wird einmal wiederholt, bevor er als gescheitert gilt.
@MainActor
final class LiveDriver {
    let model = AppModel()
    private let check: (String, Bool, String) -> Void
    private var a: Bot!
    private var b: Bot!
    private var c: Bot!
    private var session: ChatSession!
    private var created: [Bot] = []
    private static let modelId = ProcessInfo.processInfo.environment["ORBIT_TEST_MODEL"] ?? "claude-haiku-5-5"

    init(check: @escaping (String, Bool, String) -> Void) { self.check = check }

    // MARK: Aufbau

    func setUp() async throws {
        try await model.service.ensureRunning()
        check("Dienst aus der Testkopie", model.service.startedByApp || ProcessInfo.processInfo.environment["ORBITD_URL"] != nil, model.client.baseURL.absoluteString)
        await model.botStore.load()
        model.events.start()
        guard await waitUntil(15, { model.events.connected }) else { throw SpikeError("Ereignisstrom verbindet nicht.") }
        a = try await makeBot("ZZ-Karte-A", .strobi)
        b = try await makeBot("ZZ-Karte-B", .cubee)
        c = try await makeBot("ZZ-Karte-C", .kirby)
        session = model.chatStore.session(for: a.chatId)
        session.model = Self.modelId
        session.effort = "low"
        await session.load()
    }

    func cleanUp() async {
        // ORBIT_TEST_KEEP=1 lässt die Test-Orbis stehen (Fehlersuche in der Kopie).
        if ProcessInfo.processInfo.environment["ORBIT_TEST_KEEP"] != "1" { for bot in created { try? await model.client.deleteBot(id: bot.id) } }
        model.events.stop()
    }

    private func makeBot(_ name: String, _ shape: OrbiShape) async throws -> Bot {
        let editor = BotEditorModel(editing: nil, others: model.botStore.orbis)
        editor.shape = shape
        editor.name = name
        editor.selectPreset("Recherche")
        await model.save(editor)
        guard let bot = model.botStore.bots.first(where: { $0.name == name }) else { throw SpikeError(editor.error ?? "Orbi „\(name)“ nicht angelegt") }
        created.append(bot)
        return bot
    }

    // MARK: Freigabe

    func approvals() async {
        // Einmal
        if let tool = await drive("Führe mit dem Werkzeug bash genau diesen Befehl aus: echo karten-1. Nutze kein anderes Werkzeug.", until: { self.openApproval() != nil }),
           let id = tool.approvalId {
            let pending = model.events.interactions.pending[id]
            let lifetime = pending.map { $0.expiresAt.timeIntervalSince($0.requestedAt) } ?? 0
            check("Freigabe: Karte zeigt Werkzeug und Eingabe", tool.name == "bash" && tool.input?["command"]?.string?.contains("karten-1") == true, "\(tool.name): \(tool.input?["command"]?.string ?? "-")")
            check("Freigabe: wartet 24 Stunden", abs(lifetime - 86_400) < 2, "Frist \(Int(lifetime)) s")
            let phase = ApprovalPhase.resolve(tool: tool, board: model.events.interactions, live: true, now: .now)
            check("Freigabe: Karte ist offen mit Frist", { if case .open(let at?) = phase { at.timeIntervalSinceNow > 86_300 } else { false } }(), "\(phase)")
            await model.cards.decide(id, .once)
            let moved = await waitUntil(60) { self.tool(callId: tool.toolCallId)?.state != .approvalRequested }
            await waitIdle(120)
            check("Einmal erlauben: das Werkzeug läuft weiter, der Turn endet", moved && !session.isRunning && model.events.interactions.resolved[id] == "approved",
                  "Zustand \(self.tool(callId: tool.toolCallId)?.state.rawValue ?? "-"), Dienst: \(model.events.interactions.resolved[id] ?? "-")")
        } else { check("Freigabe: Karte erscheint", false, "keine offene Freigabe nach zwei Versuchen: \(session.error ?? "ohne Fehler")") }

        // Ablehnen
        if let tool = await drive("Führe mit dem Werkzeug bash genau diesen Befehl aus: echo karten-2. Nutze kein anderes Werkzeug.", until: { self.openApproval() != nil }),
           let id = tool.approvalId {
            await model.cards.decide(id, .deny)
            let denied = await waitUntil(60) { self.tool(callId: tool.toolCallId)?.state == .outputDenied || self.model.events.interactions.resolved[id] == "denied" }
            await waitIdle(120)
            check("Ablehnen: das Werkzeug läuft nicht, die Karte meldet „abgelehnt“", denied && !session.isRunning && model.events.interactions.resolved[id] == "denied",
                  "Zustand \(self.tool(callId: tool.toolCallId)?.state.rawValue ?? "-"), Dienst: \(model.events.interactions.resolved[id] ?? "-")")
        } else { check("Ablehnen: Karte erscheint", false, "keine offene Freigabe") }

        // Immer: legt eine Regel an, danach fragt der Orbi nicht mehr
        if let tool = await drive("Führe mit dem Werkzeug bash genau diesen Befehl aus: echo karten-3. Nutze kein anderes Werkzeug.", until: { self.openApproval() != nil }),
           let id = tool.approvalId {
            await model.cards.decide(id, .always)
            await waitIdle(120)
            let rules = await fetchRules()
            let rule = rules.first { $0.tool == "bash" && $0.botId == a.id && $0.mode == "allow" }
            check("Immer erlauben: Regel „allow“ für Orbi und Werkzeug gespeichert", rule != nil, "\(rules.count) Regeln")
            var asked = false
            session.send("Führe mit dem Werkzeug bash genau diesen Befehl aus: echo karten-4. Nutze kein anderes Werkzeug.")
            let deadline = Date().addingTimeInterval(120)
            while Date() < deadline, session.isRunning { if openApproval() != nil { asked = true; break }; try? await Task.sleep(for: .milliseconds(50)) }
            if asked, let id = openApproval()?.approvalId { await model.cards.decide(id, .deny) }
            await waitIdle(120)
            check("Immer erlauben: der nächste Aufruf läuft ohne Karte", !asked, asked ? "fragte trotz Regel" : "keine Freigabe verlangt")
            if let rule { _ = try? await model.client.data(for: model.client.request("/v1/settings/rules/\(rule.id)", method: "DELETE")) }
        } else { check("Immer erlauben: Karte erscheint", false, "keine offene Freigabe") }
    }

    // MARK: Rückfrage

    func questions() async {
        let prompt = "Nutze das Werkzeug ask_user und stelle genau eine Frage mit dem Text „Welche Farbe?“ und den drei Antworten Rot, Blau, Grün (Blau empfohlen). Warte auf die Antwort und nenne sie danach in einem Satz."
        if let tool = await drive(prompt, until: { self.openAsk() != nil }) {
            let questions = tool.askQuestions
            let options = questions.first?.options ?? []
            check("Rückfrage: drei Antworten, mindestens eine Empfehlung", options.count == 3 && options.contains { $0.recommended }, "\(options.count) Antworten, empfohlen: \(options.filter(\.recommended).map(\.label).joined(separator: ","))")
            let known = model.events.interactions.question(toolCallId: tool.toolCallId) != nil
            check("Rückfrage: offen laut Ereignissen (ID = Werkzeug-ID)", known, "")
            let panel = AskPanelModel(questions: questions)
            let pick = options.first { $0.recommended } ?? options.first
            if let pick { panel.choose(pick.label) }
            let answers = panel.advance()
            let error = await model.cards.answer(tool.toolCallId, answers: answers)
            await waitIdle(120)
            let done = self.tool(callId: tool.toolCallId)
            check("Rückfrage beantwortet: der Turn läuft im selben Strom weiter", error == nil && done?.askResult?.answers.first?.answers == [pick?.label ?? ""] && hasTextAfterAsk(), "Fehler \(error ?? "keiner"), Antwort \(done?.askResult?.answers.first?.answers ?? [])")
        } else { check("Rückfrage: Karte erscheint", false, "keine offene Rückfrage") }

        let multi = "Nutze das Werkzeug ask_user mit einer Frage „Welche Formen?“ (multiple=true) und den drei Antworten Kreis, Dreieck, Quadrat. Warte auf die Antwort und nenne sie danach."
        if let tool = await drive(multi, until: { self.openAsk() != nil }) {
            let panel = AskPanelModel(questions: tool.askQuestions)
            let first = tool.askQuestions.first?.options.first?.label ?? "Kreis"
            let multiple = tool.askQuestions.first?.multiple == true
            panel.choose(first)
            panel.custom = "Stern"
            let answers = panel.advance()
            // Setzt das Modell `multiple` nicht, gilt Einzelwahl: die eigene Antwort ersetzt dann die Wahl.
            let expected = multiple ? [first, "Stern"] : ["Stern"]
            check("Mehrfachauswahl mit freier Eingabe: Wahl plus eigener Text (bei Einzelwahl ersetzt der Text)", answers?.first?.answers == expected, "multiple \(multiple): \(answers?.first?.answers ?? [])")
            let error = await model.cards.answer(tool.toolCallId, answers: answers)
            await waitIdle(120)
            check("Mehrfachauswahl: Dienst nimmt die Antwort an", error == nil && self.tool(callId: tool.toolCallId)?.askResult?.answers.first?.answers == expected, error ?? "")
        } else { check("Mehrfachauswahl: Karte erscheint", false, "keine offene Rückfrage") }

        // Überspringen (X): eine leere Antwort, der Turn läuft trotzdem weiter
        if let tool = await drive(prompt, until: { self.openAsk() != nil }) {
            let error = await model.cards.answer(tool.toolCallId, answers: nil)
            await waitIdle(120)
            check("Rückfrage geschlossen (Überspringen): der Turn läuft weiter", error == nil && self.tool(callId: tool.toolCallId)?.askResult?.skipped == true && !session.isRunning, error ?? "")
        } else { check("Überspringen: Karte erscheint", false, "keine offene Rückfrage") }
        // Antwort auf eine nicht mehr offene Rückfrage: deutscher Fehler, nie still
        let stale = await model.cards.answer("gibt-es-nicht", answers: [])
        check("Nicht mehr offene Rückfrage: Fehlertext", stale == "Die Rückfrage ist nicht mehr offen.", stale ?? "kein Fehler")
    }

    // MARK: Neustart der App mit offener Freigabe

    func restart() async {
        guard let tool = await drive("Führe mit dem Werkzeug bash genau diesen Befehl aus: echo karten-5. Nutze kein anderes Werkzeug.", until: { self.openApproval() != nil }),
              let id = tool.approvalId else { return check("Neustart: offene Freigabe vorbereitet", false, "keine Freigabe") }
        // Eine zweite, frische App-Hälfte: neuer Client, neue Ereignisse, neue Sitzung (wie nach dem Start der App).
        let client = ServiceClient()
        let events = EventsStore(client: client)
        events.start()
        let snapshot = await waitUntil(15) { events.interactions.pending[id] != nil }
        let listed = (try? await client.approvals())?.contains { $0.id == id } == true
        check("Neustart: Snapshot und GET /v1/approvals liefern die offene Freigabe", snapshot && listed, "Snapshot \(snapshot), Liste \(listed)")
        let fresh = ChatSession(chatId: a.chatId, client: client)
        fresh.model = Self.modelId
        await fresh.load()
        let back = await waitUntil(15) { fresh.lastAssistant?.parts.contains { if case .tool(let t) = $0 { t.approvalId == id && t.state == .approvalRequested } else { false } } == true }
        check("Neustart: die Karte kommt über die Wiedergabe (/stream) wieder", back, "")
        let center = CardCenter(client: client, events: events)
        await center.decide(id, .deny)
        await waitIdle(120)
        _ = await waitUntil(60) { !fresh.isRunning }
        check("Neustart: aus der frischen Sitzung entscheiden, der Turn endet", !session.isRunning && !fresh.isRunning && center.errors[id] == nil, center.errors[id] ?? "")
        events.stop()
        fresh.detach()
    }

    // MARK: Jev, Fehler, Medien

    func jev() async {
        session.model = "auto"
        await waitIdle(60)
        session.send("Sag nur Hallo.")
        await waitIdle(120)
        let info = session.lastAssistant?.metadata?.jev
        let stored = (try? await model.client.messages(chatId: a.chatId))?.last?.metadata?.jev
        check("Jev: Entscheidung steht an der Antwort (Quelle, Modell, Dauer) und im Verlauf", info != nil && stored != nil, "Quelle \(info?.source ?? "-"), Modell \(info?.modelLabel ?? info?.model ?? "-"), \(Int(info?.durationMs ?? 0)) ms")
        session.model = Self.modelId
    }

    // Orbi legt eine Automation an (Werkzeug automation_create): sie erscheint in Geplant (GET /v1/automations). Danach wieder weg.
    func automationCreate() async {
        let name = "ZZ-Auto-Hallo"
        var found: AutomationItem?
        for attempt in 0..<2 {
            await waitIdle(120)
            session.send(attempt == 0
                ? "Lege jetzt mit dem Werkzeug automation_create eine Automation an. Name: \(name). Aufgabe: Schreibe nur Hallo. Zeitplan: täglich um 07:00 Uhr. Ziel: neuer Chat. Alle Angaben sind bestätigt, frag nicht nach."
                : "Bitte leg die Automation \(name) (täglich 07:00, Aufgabe: Schreibe nur Hallo) jetzt mit automation_create an, ohne Rückfrage.")
            await waitIdle(120)
            found = (try? await model.client.automations())?.automations.first { $0.automation.name == name && $0.bot.id == a.id }
            if found != nil { break }
        }
        let output = tools().last(where: { $0.name == "automation_create" })
        check("Orbi legt eine Automation an: sie erscheint in Geplant", found != nil, "Werkzeug: \(output?.state.rawValue ?? "nicht aufgerufen"), Name \(found?.automation.name ?? "-")")
        if let found {
            try? await model.client.trashAutomation(id: found.id)
            try? await model.client.deleteAutomationForever(id: found.id)
        }
    }

    // „Jetzt ausführen“ einer Automation (Ziel: gleicher Chat): der offene Chat zeigt die Aufgabe als Karte und die Antwort live,
    // ohne neu zu laden; danach stimmt der Verlauf im Dienst damit überein.
    func automationRun() async {
        await waitIdle(120)
        let name = "ZZ-Lauf-Hallo"
        let form = AutomationForm(botId: a.id, name: name, prompt: "Sag nur Hallo.", schedule: Schedule(kind: .daily, at: "07:00"), timezone: "Europe/Berlin",
                                  target: "same", notify: "none", model: Self.modelId, effort: "low", context: false)
        do { try await model.client.createAutomation(form) } catch { check("Automation anlegen", false, error.localizedDescription); return }
        guard let item = (try? await model.client.automations())?.automations.first(where: { $0.automation.name == name && $0.bot.id == a.id }) else {
            check("Automation anlegen", false, "nicht in der Liste"); return
        }
        let before = session.messages.count
        await model.automations.runNow(item)
        let card = await waitUntil(60) { self.session.messages.contains { $0.role == .user && AutomationTag.parse($0.text)?.name == name } }
        let live = await waitUntil(120) { self.session.messages.count >= before + 2 && !self.session.isRunning && self.session.messages.last?.role == .assistant && !(self.session.messages.last?.text.isEmpty ?? true) }
        let stored = (try? await model.client.messages(chatId: a.chatId)) ?? []
        check("Jetzt ausführen: die Aufgabe erscheint im offenen Chat als Automations-Karte", card, "Nachrichten \(before) → \(session.messages.count)")
        check("Jetzt ausführen: die Antwort kommt live, Verlauf stimmt mit dem Dienst überein", live && stored.count == session.messages.count, "Antwort „\(session.messages.last?.text.prefix(40) ?? "-")“, Dienst \(stored.count) Nachrichten")
        try? await model.client.trashAutomation(id: item.id)
        try? await model.client.deleteAutomationForever(id: item.id)
    }

    func modelsUnavailable() async {
        await waitIdle(30)
        session.send("Sag nur Hallo.")
        await waitIdle(120)
        let text = session.error ?? ""
        let translated = ErrorText.translate(text)
        check("Modelle nicht verfügbar: verständliche Fehlerkarte", (translated.text.contains("Dienst") || translated.text.contains("CLI")) && !session.isRunning, "Roh: \(text.prefix(90))")
        session.retry()
        _ = await waitUntil(5) { session.isRunning }
        await waitIdle(120)
        check("Modelle nicht verfügbar: „Erneut versuchen“ endet mit Fehlerkarte", !session.isRunning && session.error != nil && !session.isLimited, "")
    }

    func media() async {
        if await drive("Nutze das Werkzeug web_search und suche nach „Hono Framework“. Fasse das Ergebnis in einem Satz zusammen.", until: { self.tool(named: "web_search")?.state == .outputAvailable }, timeout: 120, waitIdleAfter: 120) != nil,
           let tool = tool(named: "web_search") {
            let info = WebSearchInfo(tool)
            check("Websuche: Quellenkarte mit Quellen", !info.sources.isEmpty && !info.query.isEmpty, "\(info.sources.count) Quellen, Anfrage „\(info.query)“")
        } else { check("Websuche: Karte erscheint", false, session.error ?? "kein Ergebnis") }
    }

    // MARK: Hilfen

    private struct Rule: Decodable { let id: String; let tool: String; let botId: String?; let mode: String }

    private func fetchRules() async -> [Rule] {
        struct Body: Decodable { let rules: [Rule] }
        return (try? await model.client.get("/v1/settings/rules", as: Body.self).rules) ?? []
    }

    private func tools() -> [ToolPart] {
        (session.lastAssistant?.parts ?? []).compactMap { if case .tool(let t) = $0 { t } else { nil } }
    }
    private func tool(callId: String) -> ToolPart? { tools().first { $0.toolCallId == callId } }
    private func tool(named name: String) -> ToolPart? { tools().last { $0.name == name } }
    private func openApproval() -> ToolPart? {
        // Nur bash: jedes andere Werkzeug (z. B. ein Brain-Werkzeug) wird nie freigegeben.
        tools().last { $0.name == "bash" && $0.state == .approvalRequested && $0.approvalId.map { model.events.interactions.pending[$0] != nil } == true }
    }
    private func openAsk() -> ToolPart? {
        tools().last { $0.name == ToolName.ask && $0.state == .inputAvailable && model.events.interactions.question(toolCallId: $0.toolCallId) != nil }
    }
    private func hasTextAfterAsk() -> Bool {
        guard let parts = session.lastAssistant?.parts, let index = parts.lastIndex(where: { if case .tool(let t) = $0 { t.name == ToolName.ask } else { false } }) else { return false }
        return parts[index...].contains { if case .text(let t) = $0 { !t.isEmpty } else { false } }
    }

    // Sendet und wartet, bis die Bedingung gilt; einmal wiederholen, wenn das Modell das Werkzeug nicht nutzt.
    private func drive(_ prompt: String, until condition: @escaping () -> Bool, timeout: TimeInterval = 90, waitIdleAfter: TimeInterval? = nil) async -> ToolPart? {
        for attempt in 0..<2 {
            await waitIdle(120)
            session.send(attempt == 0 ? prompt : "Bitte tu es jetzt wirklich, ohne Rückfragen: " + prompt)
            if await waitUntil(timeout, condition) {
                if let more = waitIdleAfter, more > 0 { await waitIdle(more) }
                return tools().last
            }
            if session.isRunning { try? await model.client.stop(chatId: a.chatId) }
            await waitIdle(30)
        }
        return nil
    }

    // Wartet auf das Ende des Turns. Probiert das Modell nach einem Fehler (Platzhalter-Sandbox) bash erneut, wird die neue
    // Freigabe abgelehnt, sonst hinge der Turn bis zum Verfall.
    private func waitIdle(_ timeout: TimeInterval) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, session.isRunning {
            if let id = openApproval()?.approvalId, model.cards.busy.isEmpty { await model.cards.decide(id, .deny) }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    private func waitUntil(_ timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return condition()
    }
}
