import Foundation

// Daten der Karten im Chat, gelesen aus den Werkzeugteilen (Form wie in components/tool-call.tsx und lib/chat/*).

enum ToolName {
    static let ask = "ask_user"
    static let handoff = "handoff"
    static let webSearch = "web_search"
    static let image = "generate_image"
}

enum ToolText {
    // Konnektor-Werkzeuge heißen intern connector_<id>__<tool> (lib/connectors/tool-label.ts).
    static func label(_ tool: String) -> String {
        guard tool.hasPrefix("connector_"), let split = tool.range(of: "__", options: .backwards) else { return tool }
        let name = tool[split.upperBound...]
        return name.isEmpty ? tool : "\(name) (Konnektor)"
    }

    // Kurzer Titel mit dem Wichtigsten aus der Eingabe (TITLES in components/tool-call.tsx).
    static func title(_ tool: ToolPart) -> String {
        func cut(_ value: JSONValue?, _ limit: Int = 48) -> String {
            let raw: String = value?.string ?? value?.number.map { String(Int($0)) } ?? ""
            let text = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            return text.count > limit ? String(text.prefix(limit)) + "…" : text
        }
        let input = tool.input
        switch tool.name {
        case "bash": return "Befehl: \(cut(input?["command"]))"
        case "read_file": return "Datei lesen: \(cut(input?["path"]))"
        case "write_file": return "Datei schreiben: \(cut(input?["path"]))"
        case "list_files": return "Ordner ansehen: \(input?["path"] == nil ? "." : cut(input?["path"]))"
        case "view_screen": return "Bildschirm angesehen"
        case "show_screen": return "Bildschirm"
        case "mouse_click": return "\(input?["double"]?.bool == true ? "Doppelklick" : "Klick") bei \(cut(input?["x"])), \(cut(input?["y"]))"
        case "mouse_move": return "Maus zu \(cut(input?["x"])), \(cut(input?["y"]))"
        case "mouse_scroll": return "Scrollen \(input?["direction"]?.string == "up" ? "nach oben" : "nach unten")"
        case "mouse_drag": return "Ziehen \(cut(input?["startX"])), \(cut(input?["startY"])) → \(cut(input?["endX"])), \(cut(input?["endY"]))"
        case "keyboard_type": return "Tippen: \(cut(input?["text"]))"
        case "keyboard_press":
            let modifiers = (input?["modifiers"]?.array ?? []).compactMap(\.string)
            return "Taste: \((modifiers + [input?["key"]?.string ?? ""]).joined(separator: "+"))"
        case "keyboard_hotkey": return "Tasten: \(cut(input?["keys"]))"
        case "wait": return "Warten: \(cut(input?["seconds"])) s"
        case "share_file": return "Datei senden: \(cut(input?["path"]))"
        default: return label(tool.name)
        }
    }

    // Kurzer Satz zum aktuellen Schritt des Ziel-Orbis (STEPS in components/tool-call.tsx).
    static func step(_ part: MessagePart?) -> String {
        switch part {
        case nil: "startet …"
        case .tool(let tool):
            ["bash": "führt Befehl aus", "write_file": "schreibt Datei …", "read_file": "liest Datei …",
             "list_files": "sieht Ordner an …", "handoff": "gibt weiter …"][tool.name] ?? "arbeitet …"
        default: "schreibt die Antwort …"
        }
    }
}

// MARK: Zustände der Freigabe- und Übergabekarte (reine Logik, geprüft in OrbitTests)

// Stand einer Freigabekarte (Quelle: offene Interaktionen aus /v1/events und der Strom des Turns).
enum ApprovalPhase: Equatable {
    case open(expiresAt: Date?)
    case expired
    case decided(approved: Bool, always: Bool = false)
    case gone
}

enum ApprovalClock {
    // Freigaben warten bis zu 24 Stunden (Phase 1); kein Zähler mehr.
    static let waitText = "Wartet bis zu 24 Stunden auf dich"
}

// Art der Freigabe (reason aus dem Dienst) auf Deutsch; bei Zugangsdaten gibt es kein „Immer“.
enum ApprovalReason {
    static func label(_ reason: String?) -> String? {
        switch reason {
        case "geld": "Geld ausgeben"
        case "veroeffentlichen": "Veröffentlichen"
        case "nachricht": "Nachricht senden"
        case "loeschen": "Endgültig löschen"
        case "geheimnis": "Zugangsdaten"
        case "system": "Systemeingriff"
        case "dauerhaft": "Dauerhafte Änderung"
        default: nil
        }
    }
    // Unbekannte Arten (neuer Dienst) gelten als Systemeingriff; ohne Angabe bleibt es nil.
    static func normalized(_ reason: String?) -> String? {
        guard let reason else { return nil }
        return label(reason) == nil ? "system" : reason
    }
    // Bei Zugangsdaten gibt es kein „Immer“.
    static func allowsAlways(_ reason: String?) -> Bool { reason != "geheimnis" }
}

extension ApprovalPhase {
    // Offen mit Verfall, abgelaufen, entschieden oder nicht mehr offen: aus Werkzeugzustand, offenen Interaktionen und Turn-Lauf.
    static func resolve(tool: ToolPart, board: InteractionBoard, live: Bool, now: Date) -> ApprovalPhase {
        let id = tool.approvalId
        if tool.state != .approvalRequested { return board.resolved[id ?? ""] == "expired" ? .expired : .gone }
        if let id, let pending = board.pending[id] { return now >= pending.expiresAt ? .expired : .open(expiresAt: pending.expiresAt) }
        switch id.flatMap({ board.resolved[$0] }) {
        case "expired": return .expired
        case "approved": return .decided(approved: true, always: id.map { board.alwaysApproved.contains($0) } ?? false)
        case "denied", "aborted": return .decided(approved: false)
        default: return live ? .open(expiresAt: nil) : .gone
        }
    }
}

// Stand einer alten Übergabe (Werkzeug `handoff`, nur noch in gespeicherten Verläufen; neu: Zeilen „gesendet an/von“), aus Werkzeugzustand und Turn-Lauf.
struct HandoffPhase: Equatable {
    enum Kind: Equatable { case waiting, running, finished, failed }
    var kind: Kind
    var target: String
    var error: String?
    var waitingForApproval = false
    var step = ""

    static func make(tool: ToolPart, info: HandoffInfo, live: Bool) -> HandoffPhase {
        let finished = tool.state == .outputAvailable && !tool.preliminary
        let running = !finished && tool.state != .outputError && live
        let target = info.to ?? (running ? "Orbi" : "unbekannter Orbi")
        let error = info.error
            ?? (tool.state == .outputError ? tool.errorText ?? "Fehler." : nil)
            ?? (finished && info.answer.isEmpty ? "Keine Antwort erhalten." : nil)
            ?? (!finished && !live ? "Unterbrochen." : nil)
        if error != nil, !running { return HandoffPhase(kind: .failed, target: target, error: error) }
        if running {
            let waiting = info.waiting
            return HandoffPhase(kind: waiting ? .waiting : .running, target: target, waitingForApproval: info.hasPendingApproval,
                                step: ToolText.step(info.lastPart))
        }
        return HandoffPhase(kind: .finished, target: target)
    }
}

// MARK: Rückfrage (ask_user)

struct AskOption: Hashable, Sendable {
    let label: String
    let description: String?
    let recommended: Bool
}

struct AskQuestion: Hashable, Sendable {
    let question: String
    let options: [AskOption]
    let multiple: Bool
    var allowsCustom = true
}

// Antwort auf eine Frage; so erwartet sie `POST /v1/questions/:id/answer`.
struct QuestionAnswer: Encodable, Hashable, Sendable {
    let question: String
    let answers: [String]
}

struct AskResult: Hashable, Sendable {
    let skipped: Bool
    let answers: [QuestionAnswer]
}

extension ToolPart {
    // Fragen aus `input.questions` (Dienstform: askUserInput in lib/chat/ask-user.ts).
    var askQuestions: [AskQuestion] {
        (input?["questions"]?.array ?? []).compactMap { item in
            guard let question = item["question"]?.string else { return nil }
            let options = (item["options"]?.array ?? []).compactMap { option -> AskOption? in
                guard let label = option["label"]?.string else { return nil }
                return AskOption(label: label, description: option["description"]?.string, recommended: option["recommended"]?.bool == true)
            }
            return AskQuestion(question: question, options: options, multiple: item["multiple"]?.bool == true,
                               allowsCustom: input?["onboardingOrbiSelection"]?.bool != true)
        }
    }

    // Antwort aus der Ausgabe; ältere Verläufe haben `answers` auch als Textliste: nie davon abstürzen.
    var askResult: AskResult? {
        guard state == .outputAvailable, let output else { return nil }
        let skipped = output["skipped"]?.bool == true
        let questions = askQuestions
        let rows: [QuestionAnswer] = (output["answers"]?.array ?? []).enumerated().map { index, item in
            if let text = item.string { return .init(question: questions.indices.contains(index) ? questions[index].question : "Frage", answers: [text]) }
            return .init(question: item["question"]?.string ?? (questions.indices.contains(index) ? questions[index].question : "Frage"),
                         answers: (item["answers"]?.array ?? []).compactMap(\.string))
        }
        return AskResult(skipped: skipped, answers: rows.isEmpty ? questions.map { .init(question: $0.question, answers: []) } : rows)
    }
}

// MARK: Übergabe (handoff)

struct HandoffInfo: Hashable, Sendable {
    var to: String?
    var avatar: String?
    var color: String?
    var task: String
    var waiting: Bool
    var error: String?
    // Bisherige Antwort des Ziels mit seinen Schritten (verschachtelte Nachricht der Ausgabe).
    var parts: [MessagePart]

    init(_ tool: ToolPart) {
        let output = tool.output
        to = output?["to"]?.string
        avatar = output?["avatar"]?.string
        color = output?["color"]?.string
        task = output?["task"]?.string ?? tool.input?["task"]?.string ?? ""
        waiting = output?["waiting"]?.bool == true
        error = output?["error"]?.string
        parts = MessagePart.list(from: output?["message"]?["parts"])
    }

    // Letzte Antwort des Ziels (nicht die Zwischenkommentare), gekürzt.
    var answer: String {
        for part in parts.reversed() {
            if case .text(let text) = part, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let flat = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                return flat.count > 80 ? String(flat.prefix(80)) + "…" : flat
            }
        }
        return ""
    }

    var lastPart: MessagePart? {
        parts.last { part in
            switch part {
            case .tool: true
            case .text(let text): !text.isEmpty
            default: false
            }
        }
    }

    var hasPendingApproval: Bool {
        parts.contains { if case .tool(let tool) = $0 { tool.state == .approvalRequested } else { false } }
    }
}

// MARK: Websuche, Bild

struct WebSource: Hashable, Sendable {
    let title: String
    let url: URL
    var domain: String { url.host() ?? url.absoluteString }
}

struct WebSearchInfo: Hashable, Sendable {
    let query: String
    let answer: String?
    let sources: [WebSource]
    let error: String?

    init(_ tool: ToolPart) {
        query = tool.input?["query"]?.string ?? ""
        answer = tool.output?["answer"]?.string
        // Nur http/https wird gezeigt (safeUrl im Web).
        sources = (tool.output?["sources"]?.array ?? []).compactMap { item in
            guard let text = item["url"]?.string, let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? "")
            else { return nil }
            return WebSource(title: item["title"]?.string ?? url.host() ?? text, url: url)
        }
        error = tool.output?["error"]?.string
    }
}

enum ImageResult: Hashable, Sendable {
    case image(Data, prompt: String)
    case failed(String)
    case omitted
}

extension ToolPart {
    var imageSize: String { input?["size"]?.string ?? "1024x1024" }
    var imagePrompt: String { input?["prompt"]?.string ?? "Generiertes Bild" }

    var imageResult: ImageResult? {
        guard state == .outputAvailable, let output else { return nil }
        if output["omitted"]?.bool == true { return .omitted }
        if output["ok"]?.bool == true, let base64 = output["data"]?.string, let data = Data(base64Encoded: base64) {
            return .image(data, prompt: imagePrompt)
        }
        return .failed(output["error"]?.string ?? "Bild wurde nicht fertig.")
    }
}

// MARK: Fehlertexte (lib/chat/error-text.ts)

enum ErrorText {
    struct Result: Equatable { let text: String; let detail: String? }

    private static func status(_ codes: String) -> String { #"(?:^|\b(?:status|http|error|code)\b[\s:=]*)(?:\#(codes))(?!\.?\w)"# }

    // Reihenfolge zählt: spezifisch vor allgemein.
    private static let rules: [(String, String)] = [
        ("active in another tab", "Dieser Chat ist in einem anderen Tab aktiv. Nutze dort weiter oder schließe den Tab."),
        ("error occurred in the server components render|omitted in production builds", "Sitzung abgelaufen oder Server-Fehler. Lade die Seite neu und versuche es erneut."),
        ("unbekanntes modell|unknown model|model[_ ]not[_ ]found|no such model", "Das gewählte Modell ist nicht verfügbar. Wähle ein anderes Modell."),
        ("zeitüberschreitung|timed?[ -]?out|ETIMEDOUT|\(status("504"))|deadline exceeded", "Zeitüberschreitung: Der Orbi hat nicht rechtzeitig geantwortet. Versuch es noch einmal."),
        (#"\#(status("40[13]"))|unauthorized|(?<![\w-])forbidden(?![\w-])|invalid api key"#, "Zugang abgelehnt. Melde dich bei der CLI des Modells neu an (siehe Einrichtung)."),
        ("overloaded", "Der Anbieter ist gerade überlastet. Versuche es gleich erneut."),
        (#"\#(status("429"))|rate.?limit|too many requests"#, "Das Modell ist gerade pausiert. Warte kurz oder wähle ein anderes Modell."),
        (#"ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|connection refused|(?:cannot|can'?t|could not|unable to|failed to) connect"#, "Der Dienst ist nicht erreichbar. Läuft er auf diesem Mac?"),
        ("failed to fetch|networkerror|network error|load failed", "Keine Verbindung zum Server. Prüfe dein Netzwerk und versuch es noch einmal."),
    ]

    static func translate(_ raw: String) -> Result {
        let raw = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return Result(text: "Die Antwort ist fehlgeschlagen.", detail: nil) }
        for (pattern, text) in rules where raw.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return Result(text: text, detail: raw)
        }
        return Result(text: raw, detail: nil)
    }
}
