import SwiftUI

// Beispieldaten und Ansichten für `--selftest-karten`: jede Karte in jedem Zustand (Web-Gegenstück: components/chat/*, tool-call.tsx).
@MainActor
enum CardGallery {
    struct Entry {
        let name: String
        let view: AnyView
    }

    static func json(_ text: String) -> JSONValue { (try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))) ?? .null }

    private static func tool(_ name: String, _ state: ToolState, input: String = "{}", output: String? = nil, error: String? = nil, preliminary: Bool = false, approvalId: String? = nil) -> ToolPart {
        ToolPart(toolCallId: "t-\(name)-\(state.rawValue)", name: name, state: state, input: json(input), output: output.map(json), errorText: error, approvalId: approvalId, preliminary: preliminary)
    }

    private static let command = #"{"command":"ls -la ~/Dokumente","apiKey":"geheim-123"}"#
    private static let longCommand = #"{"command":"find ~/Dokumente -name '*.pdf' -mtime -30 -exec cp {} /tmp/sicherung-mit-einem-sehr-langen-ordnernamen-der-nicht-in-eine-zeile-passt/ \; && echo fertig"}"#

    // Ein kleines, erzeugtes Bild als base64 (rot auf Blau), damit die Bildkarte echte Daten zeigt.
    static var sampleImage: Data {
        let size = 256
        guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return Data() }
        let sky = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [CGColor(red: 0.12, green: 0.24, blue: 0.8, alpha: 1), CGColor(red: 0.5, green: 0.27, blue: 0.5, alpha: 1)] as CFArray, locations: [0, 1])!
        context.drawLinearGradient(sky, start: CGPoint(x: 0, y: size), end: CGPoint(x: 0, y: 0), options: [])
        context.setFillColor(CGColor(red: 0.86, green: 0.31, blue: 0.24, alpha: 1))
        context.fillEllipse(in: CGRect(x: 68, y: 68, width: 120, height: 120))
        guard let image = context.makeImage() else { return Data() }
        return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) ?? Data()
    }

    static func entries() -> [Entry] {
        var list: [Entry] = []
        func add(_ name: String, _ view: some View) { list.append(Entry(name: name, view: AnyView(view))) }
        let soon = Date(timeIntervalSince1970: 1_000_000)
        func approval(_ phase: ApprovalPhase, tool: String = "bash", input: String = command, busy: Bool = false, error: String? = nil, bot: String = "Karti", expanded: Bool = true) -> some View {
            ApprovalCardView(botName: bot, tool: tool, input: json(input), phase: phase, now: soon, busy: busy, error: error, expandedInput: expanded)
        }

        // Freigabe
        add("freigabe-offen", approval(.open(expiresAt: soon.addingTimeInterval(581))))
        add("freigabe-offen-zugeklappt", approval(.open(expiresAt: soon.addingTimeInterval(581)), expanded: false))
        add("freigabe-letzte-minute", approval(.open(expiresAt: soon.addingTimeInterval(42)), expanded: false))
        add("freigabe-dauerhaft", ApprovalCardView(botName: "Karti", tool: "automation_create", input: json(#"{"name":"Morgenbriefing"}"#), text: "Karti möchte eine Automation anlegen.", detail: "Name: Morgenbriefing\nPlan: täglich um 08:00 (Europe/Berlin), neuer Chat je Lauf\nAufgabe (wörtlich):\nFasse die Nachrichten zusammen.", reason: "dauerhaft", phase: .open(expiresAt: nil), now: soon))
        add("freigabe-entwurf", ApprovalCardView(botName: "Karti", tool: "send", input: nil, text: "Sendet eine Nachricht.", detail: "Empfänger: Alex\nEntwurf: Bis morgen!", reason: "nachricht", phase: .open(expiresAt: nil)))
        add("freigabe-betrag", ApprovalCardView(botName: "Karti", tool: "pay", input: nil, text: "Gibt Geld aus.", detail: "Betrag: 12,50 EUR", reason: "geld", phase: .open(expiresAt: nil)))
        add("freigabe-geheimnis", ApprovalCardView(botName: "Karti", tool: "secret", input: nil, text: "Möchte Zugangsdaten verwenden.", reason: "geheimnis", phase: .open(expiresAt: nil)))
        add("freigabe-gruppe", ApprovalCardView(botName: "Karti", tool: "bash", input: nil, text: "Karti möchte eine Aktion ausführen.", neutral: true, phase: .open(expiresAt: nil)))
        add("freigabe-ohne-frist", approval(.open(expiresAt: nil), expanded: false))
        add("freigabe-sendet", approval(.open(expiresAt: soon.addingTimeInterval(300)), busy: true, expanded: false))
        add("freigabe-fehler", approval(.open(expiresAt: soon.addingTimeInterval(300)), error: "Die Freigabe ist abgelaufen.", expanded: false))
        add("freigabe-abgelaufen", approval(.expired, expanded: false))
        add("freigabe-erlaubt", approval(.decided(approved: true), expanded: false))
        add("freigabe-immer-erlaubt", approval(.decided(approved: true, always: true), expanded: false))
        add("freigabe-abgelehnt", approval(.decided(approved: false), expanded: false))
        add("freigabe-nicht-mehr-offen", approval(.gone, expanded: false))
        add("freigabe-brain-write", approval(.open(expiresAt: soon.addingTimeInterval(500)), tool: "brain_write", input: #"{"path":"01 Inbox/Notiz.md","content":"Hallo"}"#, expanded: false))
        add("freigabe-konnektor", approval(.open(expiresAt: soon.addingTimeInterval(500)), tool: "connector_deepwiki__read_wiki_structure", input: #"{"repo":"honojs/hono"}"#, expanded: false))
        add("freigabe-lang", approval(.open(expiresAt: soon.addingTimeInterval(500)), input: longCommand, bot: "Ein Orbi mit einem außergewöhnlich langen Namen"))

        // Rückfrage
        // Beispieltexte wie im Figma-Rahmen 04/teil-2 (139:39919), damit Bild neben Bild vergleichbar ist.
        let colorQuestion = AskQuestion(question: "Wohin soll die Reise gehen?", options: [
            AskOption(label: "Berlin", description: "Kurz, mit dem Zug erreichbar", recommended: true), AskOption(label: "Lissabon", description: "Wärmer, zwei Stunden Flug", recommended: false),
            AskOption(label: "Kopenhagen", description: nil, recommended: false)], multiple: false)
        let shapeQuestion = AskQuestion(question: "Was soll in den Plan?", options: [
            AskOption(label: "Hotel", description: nil, recommended: false), AskOption(label: "Restaurants", description: nil, recommended: false), AskOption(label: "Wetter", description: nil, recommended: false)], multiple: true)
        let sizeQuestion = AskQuestion(question: "Wie lange bleibst du?", options: [AskOption(label: "Ein Wochenende", description: nil, recommended: false), AskOption(label: "Eine Woche", description: nil, recommended: true), AskOption(label: "Zwei Wochen", description: nil, recommended: false)], multiple: false)
        func panel(_ configure: (AskPanelModel) -> Void = { _ in }, questions: [AskQuestion]? = nil, neutral: Bool = false) -> some View {
            let model = AskPanelModel(questions: questions ?? [colorQuestion, shapeQuestion, sizeQuestion])
            configure(model)
            return AskPanelView(model: model, neutral: neutral).frame(width: 560)
        }
        add("rueckfrage-einzel", panel())
        add("rueckfrage-einzel-gewaehlt", panel { $0.choose("Berlin") })
        add("rueckfrage-gruppe-gewaehlt", panel({ $0.choose("Berlin") }, neutral: true))
        add("rueckfrage-mehrfach", panel({ $0.choose("Berlin"); _ = $0.advance(); $0.choose("Hotel"); $0.choose("Wetter") }))
        add("rueckfrage-einzelfrage", panel(questions: [colorQuestion]))
        add("rueckfrage-eigene-antwort", panel({ $0.custom = "Rom" }))
        add("rueckfrage-sendet", panel({ $0.choose("Berlin"); $0.sending = true }))
        add("rueckfrage-fehler", panel { $0.choose("Berlin"); $0.error = "Die Rückfrage ist nicht mehr offen." })
        add("rueckfrage-antwort", AskSummaryView(result: AskResult(skipped: false, answers: [QuestionAnswer(question: colorQuestion.question, answers: ["Berlin"]),
            QuestionAnswer(question: shapeQuestion.question, answers: ["Hotel", "Wetter"]), QuestionAnswer(question: sizeQuestion.question, answers: [])])))
        add("rueckfrage-uebersprungen", AskSummaryView(result: AskResult(skipped: true, answers: [QuestionAnswer(question: colorQuestion.question, answers: [])])))

        // Übergabe
        let zeno = HandoffInfo(tool("handoff", .outputAvailable, input: ##"{"task":"Rechne 3 + 4"}"##, output: ##"{"to":"Zeno","avatar":"erdi","color":"#339af0","task":"Rechne 3 + 4","message":{"id":"m","role":"assistant","parts":[{"type":"tool-bash","toolCallId":"b","state":"output-available","input":{"command":"echo $((3+4))"},"output":"7"},{"type":"text","text":"3 + 4 ergibt 7."}]}}"##))
        let waiting = HandoffInfo(tool("handoff", .outputAvailable, input: ##"{"task":"Verdopple die Zahl"}"##, output: ##"{"to":"Luma","avatar":"veni","color":"#e64980","task":"Verdopple die Zahl","waiting":true}"##, preliminary: true))
        let withApproval = HandoffInfo(tool("handoff", .outputAvailable, input: ##"{"task":"Liste den Ordner"}"##, output: ##"{"to":"Zeno","avatar":"erdi","color":"#339af0","task":"Liste den Ordner","message":{"id":"m","role":"assistant","parts":[{"type":"tool-bash","toolCallId":"b","state":"approval-requested","input":{"command":"ls"},"approval":{"id":"a9"}}]}}"##, preliminary: true))
        let failed = HandoffInfo(tool("handoff", .outputAvailable, input: ##"{"task":"Lies die Datei"}"##, output: ##"{"to":"Zeno","avatar":"erdi","color":"#339af0","task":"Lies die Datei","error":"Zeno hat nicht geantwortet."}"##))
        let running = HandoffInfo(tool("handoff", .outputAvailable, input: ##"{"task":"Schreibe die Datei"}"##, output: ##"{"to":"Zeno","avatar":"erdi","color":"#339af0","task":"Schreibe die Datei","message":{"id":"m","role":"assistant","parts":[{"type":"tool-write_file","toolCallId":"b","state":"input-available","input":{"path":"a.txt"}}]}}"##, preliminary: true))
        add("uebergabe-wartet", HandoffCardView(info: waiting, phase: HandoffPhase(kind: .waiting, target: "Luma"), by: "Karti") { EmptyView() })
        add("uebergabe-laeuft", HandoffCardView(info: running, phase: HandoffPhase(kind: .running, target: "Zeno", step: "schreibt Datei …"), by: "Karti", onStop: {}) { EmptyView() })
        add("uebergabe-laeuft-parallel", HandoffCardView(info: running, phase: HandoffPhase(kind: .running, target: "Zeno", step: "schreibt Datei …"), by: "Karti", writing: true) { EmptyView() })
        add("uebergabe-freigabe", HandoffCardView(info: withApproval, phase: HandoffPhase(kind: .running, target: "Zeno", waitingForApproval: true, step: "führt Befehl aus"), by: "Karti", opened: true) {
            ApprovalCardView(botName: "Zeno", tool: "bash", input: json(#"{"command":"ls"}"#), phase: .open(expiresAt: soon.addingTimeInterval(500)), now: soon)
        })
        add("uebergabe-fertig", HandoffCardView(info: zeno, phase: HandoffPhase(kind: .finished, target: "Zeno")) { EmptyView() })
        add("uebergabe-fertig-offen", HandoffCardView(info: zeno, phase: HandoffPhase(kind: .finished, target: "Zeno"), opened: true) {
            MarkdownText(text: "3 + 4 ergibt 7.")
        })
        add("uebergabe-fehlgeschlagen", HandoffCardView(info: failed, phase: HandoffPhase(kind: .failed, target: "Zeno", error: "Zeno hat nicht geantwortet.")) { EmptyView() })

        // Jev
        let info = JevInfo(tier: "small", model: "claude-haiku-5-5", modelLabel: "Haiku 5.5", effort: "low", reason: "Kurze Frage, ein kleines Modell reicht.", confidence: 0.92, durationMs: 470)
        add("jev-zu", JevBlockView(info: info))
        add("jev-offen", JevBlockView(info: info, opened: true))
        add("jev-fallback", JevBlockView(info: JevInfo(reason: "Jev nicht verfügbar", durationMs: 3000, source: "fallback"), opened: true))

        // Bild
        add("bild-laedt", ImageCardView(phase: .loading, size: "1536x1024"))
        add("bild-fertig", ImageCardView(phase: .ready(sampleImage), prompt: "Ein roter Planet"))
        add("bild-fehler", ImageCardView(phase: .failed("Die Bildgenerierung ist fehlgeschlagen.")))
        add("bild-nicht-fertig", ImageCardView(phase: .missing))
        add("bild-nicht-weitergegeben", ImageCardView(phase: .omitted))

        // Websuche
        let search = WebSearchInfo(tool("web_search", .outputAvailable, input: #"{"query":"Hono Framework"}"#, output: #"{"answer":"Hono ist ein **kleines, schnelles** Web-Framework.","sources":[{"title":"Hono – Web Framework","url":"https://hono.dev/docs"},{"title":"Eine sehr lange Überschrift einer Quelle, die in eine Zeile passen muss","url":"https://example.com/long"}]}"#))
        add("suche-laeuft", WebSearchCardView(info: search, phase: .running))
        add("suche-fertig", WebSearchCardView(info: search, phase: .done, opened: true))
        add("suche-fehler", WebSearchCardView(info: search, phase: .failed("Die Websuche ist nicht erreichbar.")))
        add("suche-ohne-treffer", WebSearchCardView(info: WebSearchInfo(tool("web_search", .outputAvailable, input: #"{"query":"nichts"}"#, output: "{}")), phase: .done))

        add("routine-vorschlag", RoutineCardView(name: "Tägliche Übersicht", schedule: "Täglich um 08:00", botName: "Zeno", avatar: zeno.avatar, colorHex: zeno.color))
        add("routine-erstellt", RoutineCardView(name: "Tägliche Übersicht", schedule: "Täglich um 08:00", created: true))
        add("routine-laeuft", AutomationRunCard(name: "Morgenbriefing", run: AutomationMessage(automationId: "a", runId: "1", name: "Morgenbriefing", status: "running", startedAt: 0)))
        add("routine-fertig", AutomationRunCard(name: "Morgenbriefing", run: AutomationMessage(automationId: "a", runId: "2", name: "Morgenbriefing", status: "success", startedAt: 0, finishedAt: 1_793_787_600_000)))
        add("routine-fehler", AutomationRunCard(name: "Morgenbriefing", run: AutomationMessage(automationId: "a", runId: "3", name: "Morgenbriefing", status: "error", startedAt: 0), retry: {}))
        add("routine-erneuter-start", AutomationRunCard(name: "Morgenbriefing", run: AutomationMessage(automationId: "a", runId: "3", name: "Morgenbriefing", status: "error", startedAt: 0), retry: {}, retrying: true))

        // Fehlerkarte
        add("fehler-mit-detail", ErrorCard(message: "Error: 429 Too many requests", retry: {}, dismiss: {}))
        add("fehler-wiederholung", ErrorCard(message: "Verbindung unterbrochen", retrying: true))
        add("fehler-dienst", ErrorCard(message: "Cannot connect to API: connection refused", retry: {}, dismiss: {}))
        add("fehler-ohne-wiederholen", ErrorCard(message: "Der Chat ist in einem anderen Fenster offen."))
        add("fehler-haengt", ErrorCard(title: "Der Orbi antwortet seit über einer Minute nicht.", message: "", retryLabel: "Abbrechen und erneut senden", retry: {}, dismiss: {}))
        add("fehler-sehr-lang", ErrorCard(message: String(repeating: "Ein sehr langer Fehlertext ohne Ende. ", count: 12), retry: {}, dismiss: {}))

        // Kartenartige Chat-Zeilen (Figma 02/teil-11 bis teil-14, 04/teil-7).
        let nova = Bot(chatId: "nova", id: "nova", name: "Nova", avatar: "veni", color: "#e64980", job: "", instructions: nil, isMain: false, look: nil, lastMessageAt: .distantPast)
        add("live-zeile-arbeitet", LiveStatusBar(label: "Sucht im Brain …", bot: nova))
        add("live-zeile-wartet", LiveStatusBar(label: "Wartet auf deine Antwort", bot: nova, waiting: true))
        add("helfer-zeile", HelperStatusRow(helper: TaskBoard.Helper(id: "h", chatId: "c", botId: "nova", title: "Recherche Reiseziele", progress: "liest 3 Seiten"), bot: nova, stop: {}))
        add("systemhinweis-info", SystemNoticeView(notice: SystemNotice(text: "Nova ist jetzt in der Gruppe.", kind: .info)))
        add("systemhinweis-warnung", SystemNoticeView(notice: SystemNotice(text: "Versuche es erneut …", kind: .retry)))
        add("systemhinweis-fehler", SystemNoticeView(notice: SystemNotice(text: "Die Verbindung zum Modell ist abgebrochen.", kind: .error), actionLabel: "Nochmal", action: {}))
        add("rueckgaengig-zeile", UndoLine(target: UndoTarget(kind: "routine", entityId: "r", label: "Routine angelegt"), toolCallId: "galerie-undo"))
        add("gemerkt-zeile", MemorySavedLine())
        let peer = OrbiLine.Peer(id: "nova", name: "Nova", avatar: "veni", color: "#e64980")
        for (name, direction, status) in [("an-laeuft", OrbiLine.Direction.out, OrbiLine.Status.working), ("an-wartet", .out, .waiting),
                                          ("von-fertig", .in, .done), ("an-fehler", .out, .failed)] {
            add("uebergabe-zeile-\(name)", OrbiLineRow(line: OrbiLine(direction: direction, kind: direction == .in ? .reply : .message, peer: peer, text: "Bitte such drei Hotels in Lissabon.", status: status)))
        }
        add("datei-in-blase", UserFileView(file: FilePart(mediaType: "application/pdf", url: "data:application/pdf;base64,\(Data(repeating: 1, count: 2048).base64EncodedString())", filename: "Reiseplan.pdf")))

        // Weitere Chat-Zustände aus Schritt 17.
        add("unterbrochen", InterruptedHintView(busy: false, resume: {}, dismiss: {}))
        add("unterbrochen-fortsetzen", InterruptedHintView(busy: true, resume: {}, dismiss: {}))
        add("dateifilter", HStack(spacing: Theme.Spacing.sm) {
            ForEach(["Alle", "Bilder", "PDFs", "Dokumente"], id: \.self) { label in
                Button(label) {}.buttonStyle(LibraryFilterStyle(selected: label == "Bilder"))
            }
        })
        add("zeitstempel", VStack(spacing: Theme.Spacing.sm) {
            ForEach(["Heute 14:32", "Gestern 14:32", "Mo., 26. Okt. 18:05", "12. Sept. 2026, 11:20"], id: \.self) { label in
                Text(label).font(Theme.Fonts.geist(Theme.Fonts.size11, .medium))
                    .foregroundStyle(Theme.Palette.mutedForeground).frame(maxWidth: .infinity)
                    .padding(.vertical, Theme.Spacing.sm)
            }
        })
        let sampleBot = Bot(chatId: "beispiel", id: "beispiel", name: "Orbi", avatar: "strobi", color: nil, job: "", instructions: nil, isMain: false, look: nil, lastMessageAt: .distantPast)
        for (name, text) in [("github", "https://github.com/example/orbit"), ("web", "https://example.org/seite"),
                             ("im-text", "Hier ist die [Anleitung](https://example.org/anleitung) für dich.")] {
            add("nachricht-link-\(name)", MessageRow(message: ChatMessage(id: "link-\(name)", role: .assistant, parts: [.text(text)]), orbi: sampleBot).frame(width: 760))
        }

        // Nachrichten
        let longText = (1...40).map { "Absatz \($0): Dieser Text ist absichtlich sehr lang, damit Umbrüche und Höhen geprüft werden." }.joined(separator: "\n\n")
        add("nachricht-sehr-lang", MessageRow(message: ChatMessage(id: "m", role: .assistant, parts: [.text(longText)]), orbi: nil).frame(width: 760))
        add("nachricht-gestoppt", MessageRow(message: ChatMessage(id: "m", role: .assistant, parts: [.text("Ich fange an und")], stopped: true), orbi: nil).frame(width: 760))
        for (label, action) in [("unsichtbar", nil), ("sichtbar", "aktionen-sichtbar")] {
            for role in [ChatRole.user, .assistant] {
                let message = ChatMessage(id: "beispiel", role: role, parts: [.text("Eine kurze Beispielnachricht.")])
                add("nachricht-aktionen-\(role == .user ? "eigen" : "orbi")-\(label)",
                    MessageRow(message: message, orbi: sampleBot, onReact: { _, _ in }, onReply: { _, _ in })
                        .frame(width: 760).environment(\.screenAction, action))
            }
        }
        // Mehrere Blasen in einer Antwort: jede mit eigener Aktionsleiste, die Reaktion an der zweiten Blase (`~t1`).
        let say = ToolPart(toolCallId: "s1", name: ToolPart.sayName, state: .outputAvailable, input: .object(["text": .string("Kurz dazwischen.")]), output: .object(["ok": .bool(true)]))
        let multi = ChatMessage(id: "mb", role: .assistant, parts: [.text("Erste Blase."), .tool(say), .text("Zweite Blase mit Reaktion.")])
        for (label, names) in [("direkt", [String]()), ("gruppe", ["Orbi"])] {
            add("nachricht-mehrere-blasen-\(label)",
                MessageRow(message: multi, orbi: sampleBot, senderNames: names, reactions: ReactionBoard([Reaction(messageId: "mb~t1", actor: "user", emoji: "👍")]),
                           onReact: { _, _ in }, onReply: { _, _ in })
                    .frame(width: 760).environment(\.screenAction, "aktionen-sichtbar"))
        }
        var infoMeta = ChatMetadata()
        infoMeta.model = "Orbit Pro"
        infoMeta.inputTokens = 1284
        infoMeta.startedAt = 0
        infoMeta.finishedAt = 3200
        add("nachricht-info", MessageInfoCard(rows: InfoText.compactRows(infoMeta)).frame(width: Theme.Metrics.pt208).menuSurface().padding(Theme.Metrics.pt16))
        let quoteSession = ChatSession(chatId: "galerie-zitat", client: ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, tokenOverride: { "" }))
        quoteSession.replyTarget = ChatMessage(
            id: "zitat",
            role: .assistant,
            parts: [.text("Alles klar, das ist jetzt zu viel. Ich sag Coding, dass die Blasen höchstens etwa 60 % der Spalte einnehmen.")]
        )
        add("eingabe-zitat-pille", ComposerView(session: quoteSession).frame(width: 560))
        return list
    }
}
