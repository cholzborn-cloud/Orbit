import Foundation

enum LibraryFileFilter {
    static func matches(_ filter: String, filename: String, mediaType: String, query: String) -> Bool {
        guard query.isEmpty || filename.localizedCaseInsensitiveContains(query) else { return false }
        let type = mediaType.lowercased()
        switch filter {
        case "Alle": return true
        case "Bilder": return type.hasPrefix("image/")
        case "PDFs": return type == "application/pdf"
        case "Dokumente":
            return type.hasPrefix("text/") || type.hasPrefix("application/vnd.openxmlformats-officedocument.")
                || type.hasPrefix("application/vnd.oasis.opendocument.")
                || ["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/rtf", "application/json"].contains(type)
        default: return false
        }
    }
}

// Phase 3 (Lauf B, korrigiert in Lauf D): Statusleiste, Zwischennachrichten (`say`), Reaktionen, Dateikarten, Systemhinweise, Onboarding.
// Reine Logik ohne Netz, Uhr und Oberfläche, damit sie sich testen lässt (plan/API.md, Abschnitt „Phase 3“).

// MARK: Teile einer Antwort

extension ToolPart {
    static let sayName = "say"
    static let reactName = "react"
    static let onboardingFinishName = "onboarding_finish"

    var isSay: Bool { name == Self.sayName }
    var isReact: Bool { name == Self.reactName }
    var isOnboardingFinish: Bool { name == Self.onboardingFinishName }
    // Datei, die der Dienst nach dem Schreiben einer Datei von selbst als Karte anlegt (Id `auto-…`).
    var isAutoFile: Bool { toolCallId.hasPrefix("auto-") }

    // Text einer Zwischennachricht; leer oder fehlgeschlagen = keine Blase.
    var sayText: String? {
        guard isSay, state != .outputError, state != .outputDenied, output?["ok"]?.bool != false else { return nil }
        let text = input?["text"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
    // Zeitpunkt der Zwischennachricht (`output.at`, Unix-ms).
    var sayDate: Date? { output?["at"]?.number.map { Date(timeIntervalSince1970: $0 / 1000) } }

    // Karten, die im Verlauf stehen: Freigabe, Auswahl, Datei (und Bild, Bildschirm, Übergabe). Alle anderen Werkzeuge zeigt die App nie (Lauf D).
    // Phase 5: der Orbi hat etwas dauerhaft gemerkt (memory_save mit ok:true). Nur eine kleine Zeile „Gemerkt ✓“, keine Karte.
    var memorySaved: Bool { name == "memory_save" && state == .outputAvailable && output?["ok"]?.bool == true }

    var isVisibleInChat: Bool {
        if isSay || isReact || isOnboardingFinish { return false }
        if state == .approvalRequested || state == .outputDenied { return true }
        if name == ToolName.ask || name == ToolName.handoff { return true }
        let files = ["share_file", "create_pdf", "create_word"]
        if files.contains(name) || [ToolName.image, "show_screen"].contains(name) {
            return state == .outputAvailable || state == .outputError || output?["error"]?.string != nil
        }
        return false
    }
}

extension MessagePart {
    // Text mit sichtbarem Inhalt. Reine Leerzeilen (das Modell schreibt oft „\n“ vor einen Werkzeugaufruf) ergeben keine Blase.
    var isVisibleText: Bool {
        if case .text(let text) = self { return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return false
    }
}

extension ChatMessage {
    var tools: [ToolPart] { parts.compactMap { if case .tool(let tool) = $0 { tool } else { nil } } }

    // Teile einer Antwort, die im Verlauf eine eigene Zeile bekommen (Blase, Karte, Datei, Rückgängig-Zeile), mit ihrem Index in `parts`.
    func answerParts(botId: String?) -> [(offset: Int, element: MessagePart)] {
        parts.enumerated().filter { _, part in
            switch part {
            case .reasoning, .other, .notice: false
            case .text: part.isVisibleText
            case .tool(let tool): tool.sayText != nil || tool.isVisibleInChat || tool.memorySaved || tool.undoTarget(botId: botId) != nil
            default: true
            }
        }.map { (offset: $0.offset, element: $0.element) }
    }

    // Hat die Antwort etwas für eine Zeile im Verlauf: Text, Zwischennachricht, Karte oder Datei. Nur `react` allein: nein.
    var hasBubbleContent: Bool {
        parts.contains { part in
            switch part {
            case .text: part.isVisibleText
            case .tool(let tool): tool.sayText != nil || tool.isVisibleInChat || tool.memorySaved
            case .file: true
            default: false
            }
        }
    }
}

// MARK: Live-Zeile

enum LiveLabel {
    // Live-Zeile ohne laufenden Schritt: sagt, was gerade passiert, nie „Limit“ o. Ä.
    static func fallback(lastPart: MessagePart?) -> String {
        switch lastPart {
        case nil, .reasoning?: "Denkt nach …"
        case .text?: "Schreibt …"
        default: "Arbeitet …"
        }
    }
}

// MARK: Systemzeile (Wiederholung, Handlungsbedarf)

// Kurzer Hinweis des Dienstes: „Versuche es erneut …“ oder „Bitte … erlauben“. Das Format liegt nicht fest, alles wird tolerant gelesen:
// Ereignis `notice`, Datenteil `data-notice` im Verlauf oder Strom, jeweils mit `text` und `kind`.
struct SystemNotice: Hashable, Sendable {
    enum Kind: Sendable { case info, retry, action, error }

    var text: String
    var kind: Kind

    // Wiederholung und Info sind ruhig; Handlungsbedarf und Fehler stehen im Fehlerton.
    var isAlert: Bool { kind == .action || kind == .error }

    init(text: String, kind: Kind = .info) { self.text = text; self.kind = kind }

    init?(json: [String: Any]) {
        let body = (json["data"] as? [String: Any]) ?? json
        guard let raw = (body["text"] as? String) ?? (body["message"] as? String) else { return nil }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        self.text = String(text.prefix(200))
        kind = Self.kind(body["kind"] as? String)
    }

    static func kind(_ raw: String?) -> Kind {
        switch raw?.lowercased() {
        case "retry", "wiederholung", "wiederholen": .retry
        case "action", "aktion", "todo", "needs-action", "handlung": .action
        case "error", "fehler", "failed": .error
        default: .info
        }
    }

    // Gelesene Form eines Datenteils: `{ text | message, kind }`, jedes Feld einzeln tolerant.
    struct Body: Decodable {
        let text: String?
        let message: String?
        let kind: String?
        private enum Keys: String, CodingKey { case text, message, kind }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? nil
            message = (try? c.decodeIfPresent(String.self, forKey: .message)) ?? nil
            kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil
        }
        var notice: SystemNotice? {
            var json: [String: Any] = [:]
            if let text { json["text"] = text } else if let message { json["message"] = message }
            if let kind { json["kind"] = kind }
            return SystemNotice(json: json)
        }
    }

    // Ereignis `notice { chatId, text, kind }`.
    static func event(from data: Data) -> (chatId: String, notice: SystemNotice)? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["type"] as? String == "notice",
              let chatId = json["chatId"] as? String, let notice = SystemNotice(json: json) else { return nil }
        return (chatId, notice)
    }
}

// Aktuelle Systemzeile je Chat (Ereignis `notice`). Sie gilt nur während der Arbeit und verschwindet mit dem Ende des Turns.
struct NoticeBoard: Equatable, Sendable {
    private(set) var current: [String: SystemNotice] = [:]

    mutating func apply(line: Data) {
        if let event = SystemNotice.event(from: line) { current[event.chatId] = event.notice; return }
        guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = json["type"] as? String else { return }
        switch type {
        case "snapshot": current = [:]
        case "status":
            guard let chatId = json["chatId"] as? String, let status = json["status"] as? String else { return }
            // Der Hinweis gilt nur während der Arbeit (plan/API.md): mit dem Ende des Turns verschwindet er.
            if ["fertig", "fehler", "ruhig"].contains(status) { current[chatId] = nil }
        default: break
        }
    }

    func notice(forChat chatId: String) -> SystemNotice? { current[chatId] }
}

// MARK: Statusleiste (Ereignis `status-step`)

struct StepBoard: Equatable, Sendable {
    struct Step: Equatable, Sendable {
        var chatId: String
        var botId: String
        var toolCallId: String
        var tool: String
        var label: String
        var step: Int
        var at: Double

        init?(json: [String: Any]) {
            guard let chatId = json["chatId"] as? String, let botId = json["botId"] as? String, let id = json["toolCallId"] as? String,
                  let label = json["label"] as? String, !label.isEmpty else { return nil }
            self.chatId = chatId; self.botId = botId; toolCallId = id; self.label = label
            tool = json["tool"] as? String ?? ""
            step = (json["step"] as? NSNumber)?.intValue ?? 0
            at = (json["at"] as? NSNumber)?.doubleValue ?? 0
        }
    }

    // Laufende Schritte je Chat (mehrere, wenn Werkzeuge parallel laufen); gezeigt wird der zuletzt gestartete.
    private(set) var running: [String: [Step]] = [:]

    mutating func apply(line: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = json["type"] as? String else { return }
        switch type {
        case "snapshot":
            running = [:]
            for item in json["steps"] as? [[String: Any]] ?? [] { if let step = Step(json: item) { running[step.chatId, default: []].append(step) } }
        case "status-step":
            guard let step = Step(json: json) else { return }
            if json["state"] as? String == "end" {
                running[step.chatId]?.removeAll { $0.toolCallId == step.toolCallId }
                if running[step.chatId]?.isEmpty == true { running[step.chatId] = nil }
            } else {
                var list = running[step.chatId] ?? []
                list.removeAll { $0.toolCallId == step.toolCallId }
                list.append(step)
                running[step.chatId] = list
            }
        case "status":
            // Turn zu Ende (fertig, Fehler, ruhig): nichts bleibt hängen. Bei „arbeitet“ und „wartet“ bleibt der Stand.
            if let chatId = json["chatId"] as? String, ["fertig", "fehler", "ruhig"].contains(json["status"] as? String ?? "") { running[chatId] = nil }
        default: break
        }
    }

    func current(forChat chatId: String) -> Step? {
        running[chatId]?.max { ($0.step, $0.at) < ($1.step, $1.at) }
    }
}

// MARK: Reaktionen

struct Reaction: Hashable, Sendable, Decodable {
    let messageId: String
    let actor: String
    let emoji: String
    var createdAt: Double

    private enum CodingKeys: String, CodingKey { case messageId, actor, emoji, createdAt }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messageId = try c.decode(String.self, forKey: .messageId)
        actor = try c.decode(String.self, forKey: .actor)
        emoji = try c.decode(String.self, forKey: .emoji)
        createdAt = (try? c.decodeIfPresent(Double.self, forKey: .createdAt)) ?? 0
    }
    init(messageId: String, actor: String, emoji: String, createdAt: Double = 0) {
        self.messageId = messageId; self.actor = actor; self.emoji = emoji; self.createdAt = createdAt
    }
}

// Alle Reaktionen eines Chats. Je Absender und Nachricht eine; eine neue ersetzt die alte.
struct ReactionBoard: Equatable, Sendable {
    static let userActor = "user"
    // Feste Liste wie im Dienst (lib/chat/reactions.ts).
    static let emojis = ["👍", "✅", "😂", "❤️", "👎", "🤔"]

    struct Group: Equatable, Sendable, Identifiable {
        let emoji: String
        let actors: [String]
        var id: String { emoji }
        var count: Int { actors.count }

        // „dir“ für Consti, sonst die Namen der Orbis (für die Bedienungshilfe der Pille).
        func names(bots: [Bot]) -> String {
            actors.map { id in id == ReactionBoard.userActor ? "dir" : (bots.first { $0.id == id }?.name ?? "einem Orbi") }.joined(separator: ", ")
        }
    }

    private(set) var items: [Reaction] = []

    init(_ items: [Reaction] = []) { self.items = items }

    mutating func set(messageId: String, actor: String, emoji: String?, at: Double = 0) {
        items.removeAll { $0.messageId == messageId && $0.actor == actor }
        if let emoji, !emoji.isEmpty { items.append(Reaction(messageId: messageId, actor: actor, emoji: emoji, createdAt: at)) }
    }

    func reactions(for messageId: String) -> [Reaction] {
        items.filter { $0.messageId == messageId }.sorted { ($0.createdAt, $0.actor) < ($1.createdAt, $1.actor) }
    }

    // Gleiche Emojis zusammengefasst, in der Reihenfolge der ersten Reaktion.
    func groups(for messageId: String) -> [Group] {
        var order: [String] = []
        var actors: [String: [String]] = [:]
        for reaction in reactions(for: messageId) {
            if actors[reaction.emoji] == nil { order.append(reaction.emoji) }
            actors[reaction.emoji, default: []].append(reaction.actor)
        }
        return order.map { Group(emoji: $0, actors: actors[$0] ?? []) }
    }

    func mine(for messageId: String) -> String? {
        items.first { $0.messageId == messageId && $0.actor == Self.userActor }?.emoji
    }

    // Ereignis `reaction { chatId, messageId, actor, emoji | null }`.
    static func event(from data: Data) -> (chatId: String, messageId: String, actor: String, emoji: String?)? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["type"] as? String == "reaction",
              let chatId = json["chatId"] as? String, let messageId = json["messageId"] as? String, let actor = json["actor"] as? String else { return nil }
        return (chatId, messageId, actor, json["emoji"] as? String)
    }
}

// MARK: Onboarding

enum OnboardingRule {
    // Der erste angelegte Orbi ist der Hauptorbi und führt das Onboarding im Chat.
    static func firstOrbiIsMain(existingOrbis: Int) -> Bool { existingOrbis == 0 }
}

enum OnboardingEvent {
    // Ereignis `orbis-created { bots:[{ botId, chatId, name }] }`: neue Orbis, Liste neu laden.
    static func isOrbisCreated(_ data: Data) -> Bool {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["type"] as? String == "orbis-created"
    }

    // Ereignis `onboarding { botId, done, instructions }`.
    static func parse(_ data: Data) -> (botId: String, done: Bool, instructions: Bool)? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["type"] as? String == "onboarding",
              let botId = json["botId"] as? String else { return nil }
        return (botId, json["done"] as? Bool ?? false, json["instructions"] as? Bool ?? false)
    }
}

// Turn-Körper des Onboardings: leere Nachrichten, `onboarding: true` (plan/API.md). Ohne dieses Feld gilt der Orbi als übersprungen.
struct OnboardingTurnBody: Encodable {
    struct ClientData: Encodable {
        let model: String
        let botId: String
        let onboarding = true
    }
    let messages: [String] = []
    let clientData: ClientData
    let trigger = "submit-message"

    init(model: String, botId: String) { clientData = ClientData(model: model, botId: botId) }
}

// MARK: Dateikarten

enum FileCardRules {
    // Nur harmlose Typen öffnet ein Klick direkt; alles andere (Skripte, Programme) wird nur gesichert.
    private static let openable: Set<String> = [
        "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "txt", "md", "csv", "json", "rtf", "docx", "xlsx", "pptx", "pages", "numbers", "key", "svg",
    ]

    static func canOpen(filename: String?) -> Bool {
        guard let ext = filename.map({ ($0 as NSString).pathExtension.lowercased() }) else { return false }
        return openable.contains(ext)
    }

    // Kurzer Typ für die zweite Zeile der Karte.
    static func kind(mediaType: String, filename: String?) -> String {
        let ext = filename.map { ($0 as NSString).pathExtension.lowercased() } ?? ""
        switch ext {
        case "pdf": return "PDF"
        case "docx", "doc", "pages": return "Dokument"
        case "xlsx", "csv", "numbers": return "Tabelle"
        case "pptx", "key": return "Folien"
        case "md", "txt", "rtf": return "Text"
        case "json": return "Daten"
        default: break
        }
        if mediaType.hasPrefix("image/") { return "Bild" }
        return ext.isEmpty ? "Datei" : ext.uppercased()
    }

    static func symbol(mediaType: String, filename: String?) -> String {
        switch kind(mediaType: mediaType, filename: filename) {
        case "PDF": "doc.richtext"
        case "Bild": "photo"
        case "Tabelle": "tablecells"
        case "Folien": "rectangle.on.rectangle"
        default: "doc.text"
        }
    }

    // Dateiname ohne Pfadanteile (nie aus dem Ordner schreiben, den das Modell wählt).
    static func safeName(_ filename: String?) -> String {
        let name = ((filename ?? "") as NSString).lastPathComponent.trimmingCharacters(in: .whitespaces)
        return name.isEmpty || name == "." || name == ".." ? "Datei" : name
    }
}

// MARK: Blasen

// Jede Blase (Text-Teil, Zwischennachricht `say`) hat eigene Aktionen und Reaktionen. Schlüssel wie im Dienst (lib/chat/reactions.ts):
// die erste Blase trägt die Nachrichten-Id (ältere Reaktionen, `react` der Orbis), weitere `<id>~t<n>` (n-ter Text-Teil) bzw. `<id>~<toolCallId>`.
extension ChatMessage {
    static let bubbleSeparator = "~"

    // Teil-Index → Schlüssel der Blase im Dienst (`<id>~t<n>`, `<id>~<toolCallId>`), nur für sichtbare Blasen; damit zitiert der Dienst genau sie.
    var bubbleParts: [Int: String] {
        var keys: [Int: String] = [:]
        var textIndex = 0
        for (offset, part) in parts.enumerated() {
            if case .text = part {
                if part.isVisibleText { keys[offset] = id + Self.bubbleSeparator + "t\(textIndex)" }
                textIndex += 1
            } else if case .tool(let tool) = part, tool.sayText != nil {
                keys[offset] = id + Self.bubbleSeparator + tool.toolCallId
            }
        }
        return keys
    }

    // Reaktionen: die erste Blase trägt die reine Nachrichten-Id.
    var bubbleKeys: [Int: String] {
        var keys = bubbleParts
        if let first = keys.keys.min() { keys[first] = id }
        return keys
    }
}
