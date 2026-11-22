import Foundation

// Nachrichten und Strom-Chunks nach plan/API.md (AI-SDK-UI-Format). Nur, was die Oberfläche braucht; Unbekanntes bleibt `.other`.

struct ChatMetadata: Codable, Hashable, Sendable {
    var createdAt: Double?
    var automation: AutomationMessage?
    var botId: String?
    var model: String?
    var effort: String?
    var startedAt: Double?
    var finishedAt: Double?
    var inputTokens: Int?
    var outputTokens: Int?
    var reasoningTokens: Int?
    var cachedTokens: Int?
    // Phase 4: Cache-Schreib-Tokens, Anzahl Schritte und Kosten in Dollar (alle nur, wenn der Dienst sie liefert).
    var cacheWriteTokens: Int?
    var steps: Int?
    var costUsd: Double?
    var jev: JevInfo?
    var skill: SkillRef?
    var replyTo: String?
    var replyQuote: ReplyQuote?
    // Phase 2: `orbi-line` bei gespeicherten Zeilen „gesendet an/von“; `rootTaskId` gehört zum Auftrag (nur Anzeige).
    var kind: String?
    var rootTaskId: String?

    // Start- und Endwerte eines Turns werden zusammengeführt.
    mutating func merge(_ other: ChatMetadata) {
        createdAt = other.createdAt ?? createdAt
        automation = other.automation ?? automation
        botId = other.botId ?? botId
        model = other.model ?? model
        effort = other.effort ?? effort
        startedAt = other.startedAt ?? startedAt
        finishedAt = other.finishedAt ?? finishedAt
        inputTokens = other.inputTokens ?? inputTokens
        outputTokens = other.outputTokens ?? outputTokens
        reasoningTokens = other.reasoningTokens ?? reasoningTokens
        cachedTokens = other.cachedTokens ?? cachedTokens
        cacheWriteTokens = other.cacheWriteTokens ?? cacheWriteTokens
        steps = other.steps ?? steps
        costUsd = other.costUsd ?? costUsd
        jev = other.jev ?? jev
        skill = other.skill ?? skill
        replyTo = other.replyTo ?? replyTo
        replyQuote = other.replyQuote ?? replyQuote
        kind = other.kind ?? kind
        rootTaskId = other.rootTaskId ?? rootTaskId
    }
}

// Tolerant gelesen: ein falscher Typ in einem Feld (etwa Kosten als Text) lässt nur dieses Feld leer, nie die ganze Antwort.
extension ChatMetadata {
    private enum LenientKeys: String, CodingKey {
        case createdAt, automation, botId, model, effort, startedAt, finishedAt, inputTokens, outputTokens, reasoningTokens, cachedTokens
        case cacheWriteTokens, steps, costUsd, jev, skill, kind, rootTaskId, replyTo, replyQuote
    }

    init(from decoder: any Decoder) throws {
        self.init()
        let c = try decoder.container(keyedBy: LenientKeys.self)
        createdAt = c.lenientDouble(.createdAt)
        automation = try? c.decodeIfPresent(AutomationMessage.self, forKey: .automation)
        botId = c.lenientString(.botId)
        model = c.lenientString(.model)
        effort = c.lenientString(.effort)
        startedAt = c.lenientDouble(.startedAt)
        finishedAt = c.lenientDouble(.finishedAt)
        inputTokens = c.lenientInt(.inputTokens)
        outputTokens = c.lenientInt(.outputTokens)
        reasoningTokens = c.lenientInt(.reasoningTokens)
        cachedTokens = c.lenientInt(.cachedTokens)
        cacheWriteTokens = c.lenientInt(.cacheWriteTokens)
        steps = c.lenientInt(.steps)
        costUsd = c.lenientDouble(.costUsd)
        jev = (try? c.decodeIfPresent(JevInfo.self, forKey: .jev)) ?? nil
        skill = (try? c.decodeIfPresent(SkillRef.self, forKey: .skill)) ?? nil
        replyTo = c.lenientString(.replyTo)
        replyQuote = try? c.decodeIfPresent(ReplyQuote.self, forKey: .replyQuote)
        kind = c.lenientString(.kind)
        rootTaskId = c.lenientString(.rootTaskId)
    }
}

struct ReplyQuote: Codable, Hashable, Sendable { let role: String; let text: String }

// Slash-Skill, mit dem eine Nachricht gesendet wurde (Chip in der Nachricht).
struct SkillRef: Codable, Hashable, Sendable { let name: String; let source: String }

// Jev-Entscheidung (lib/jev/types.ts). Fehlende Felder bekommen Standardwerte, damit eine Lücke nie die ganze Antwort verwirft.
struct JevInfo: Codable, Hashable, Sendable {
    var kind: String
    var tier: String?
    var model: String?
    var modelLabel: String?
    var effort: String?
    var reason: String
    var confidence: Double?
    var durationMs: Double
    var source: String
    var target: String?
    // Phase 4 (Lauf I): was die Stufung getan hat (start, keep, upgrade, reset, pinned, fallback) und von welchem Modell aus.
    var change: String?
    var from: String?

    init(kind: String = "route", tier: String? = nil, model: String? = nil, modelLabel: String? = nil, effort: String? = nil,
         reason: String, confidence: Double? = nil, durationMs: Double, source: String = "jev", target: String? = nil,
         change: String? = nil, from: String? = nil) {
        self.change = change; self.from = from
        self.kind = kind; self.tier = tier; self.model = model; self.modelLabel = modelLabel; self.effort = effort
        self.reason = reason; self.confidence = confidence; self.durationMs = durationMs; self.source = source; self.target = target
    }

    private enum CodingKeys: String, CodingKey { case kind, tier, model, modelLabel, effort, reason, confidence, durationMs, source, target, change, from }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? "route"
        tier = try? c.decodeIfPresent(String.self, forKey: .tier)
        model = try? c.decodeIfPresent(String.self, forKey: .model)
        modelLabel = try? c.decodeIfPresent(String.self, forKey: .modelLabel)
        effort = try? c.decodeIfPresent(String.self, forKey: .effort)
        reason = (try? c.decodeIfPresent(String.self, forKey: .reason)) ?? ""
        confidence = try? c.decodeIfPresent(Double.self, forKey: .confidence)
        durationMs = (try? c.decodeIfPresent(Double.self, forKey: .durationMs)) ?? 0
        source = (try? c.decodeIfPresent(String.self, forKey: .source)) ?? "jev"
        target = try? c.decodeIfPresent(String.self, forKey: .target)
        change = try? c.decodeIfPresent(String.self, forKey: .change)
        from = try? c.decodeIfPresent(String.self, forKey: .from)
    }
}

enum ToolState: String, Hashable, Sendable {
    case inputStreaming = "input-streaming"
    case inputAvailable = "input-available"
    case outputAvailable = "output-available"
    case outputError = "output-error"
    case outputDenied = "output-denied"
    case approvalRequested = "approval-requested"
    case approvalResponded = "approval-responded"

    var label: String {
        switch self {
        case .inputStreaming: "bereitet vor"
        case .inputAvailable: "läuft"
        case .outputAvailable: "fertig"
        case .outputError: "Fehler"
        case .outputDenied: "abgelehnt"
        case .approvalRequested: "wartet auf Freigabe"
        case .approvalResponded: "Freigabe erteilt"
        }
    }
}

struct ToolPart: Hashable, Sendable {
    let toolCallId: String
    var name: String
    var state: ToolState
    var input: JSONValue?
    var output: JSONValue?
    var errorText: String?
    // Freigabe-ID (wie in /v1/approvals); steht erst nach `tool-approval-request`.
    var approvalId: String?
    // Zwischenstand einer Übergabe: das Ziel arbeitet noch.
    var preliminary = false
}

enum MessagePart: Hashable, Sendable {
    case text(String)
    case reasoning(String)
    case tool(ToolPart)
    case file(FilePart)
    // Phase 2: Zeile „Nachricht gesendet an / von @Orbi“ (`data-orbi-message`).
    case orbiLine(OrbiLine)
    // Lauf D: kurze Systemzeile des Dienstes (`data-notice`).
    case notice(SystemNotice)
    case other(String)
}

// Datei in einer Nachricht (data:-URL wie gesendet oder gespeichert).
struct FilePart: Hashable, Sendable {
    let mediaType: String
    let url: String
    let filename: String?
}

enum ChatRole: String, Codable, Sendable {
    case user, assistant, system
}

struct ChatMessage: Identifiable, Hashable, Sendable {
    let id: String
    var role: ChatRole
    var parts: [MessagePart]
    var metadata: ChatMetadata?
    // Nur lokal: Der Turn wurde gestoppt.
    var stopped = false

    var text: String {
        parts.compactMap { if case .text(let text) = $0 { text } else { nil } }.joined(separator: "\n\n")
    }

    // Gespeicherte Zeile „gesendet an/von“ (kein Gesprächsbeitrag: keine Blase, kein Modellkontext).
    var orbiLine: OrbiLine? {
        for case .orbiLine(let line) in parts { return line }
        return nil
    }
    var isLine: Bool { orbiLine != nil }
    // Kurze Systemzeile des Dienstes in dieser Nachricht (Wiederholung, Handlungsbedarf).
    var notice: SystemNotice? {
        for case .notice(let notice) in parts { return notice }
        return nil
    }

    // Eine Antwort ohne Text, Werkzeug, Datei oder Zeile (Mitglied schweigt im Gruppenchat, nur Denken): zeigt keine Blase.
    var isSilent: Bool {
        !stopped && !parts.contains { part in
            switch part {
            case .text(let text): !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            case .tool, .file, .orbiLine, .notice: true
            case .reasoning, .other: false
            }
        }
    }

    static func user(_ text: String, files: [FilePart] = [], skill: SkillRef? = nil) -> ChatMessage {
        var parts: [MessagePart] = files.map { .file($0) }
        if !text.isEmpty { parts.append(.text(text)) }
        var metadata = ChatMetadata(createdAt: Date().timeIntervalSince1970 * 1000)
        metadata.skill = skill
        return ChatMessage(id: UUID().uuidString, role: .user, parts: parts, metadata: metadata)
    }
}

extension ChatMessage: Decodable {
    private enum CodingKeys: String, CodingKey { case id, role, parts, metadata }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        role = try container.decode(ChatRole.self, forKey: .role)
        metadata = try? container.decodeIfPresent(ChatMetadata.self, forKey: .metadata)
        parts = try container.decode([PartDTO].self, forKey: .parts).map(\.part)
    }

    fileprivate struct PartDTO: Decodable {
        let part: MessagePart

        private enum Keys: String, CodingKey { case type, text, mediaType, url, filename, toolCallId, toolName, state, input, output, errorText, approval, preliminary, data }
        private struct Approval: Decodable { let id: String? }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: Keys.self)
            let type = try container.decode(String.self, forKey: .type)
            func tool(named name: String) throws -> MessagePart {
                .tool(ToolPart(
                    toolCallId: try container.decodeIfPresent(String.self, forKey: .toolCallId) ?? UUID().uuidString,
                    name: name,
                    state: ToolState(rawValue: try container.decodeIfPresent(String.self, forKey: .state) ?? "") ?? .outputAvailable,
                    input: try? container.decodeIfPresent(JSONValue.self, forKey: .input),
                    output: try? container.decodeIfPresent(JSONValue.self, forKey: .output),
                    errorText: try? container.decodeIfPresent(String.self, forKey: .errorText),
                    approvalId: (try? container.decodeIfPresent(Approval.self, forKey: .approval))?.id,
                    preliminary: (try? container.decodeIfPresent(Bool.self, forKey: .preliminary)) ?? false))
            }
            switch type {
            case "text":
                part = .text(try container.decodeIfPresent(String.self, forKey: .text) ?? "")
            case "file":
                part = .file(FilePart(mediaType: try container.decodeIfPresent(String.self, forKey: .mediaType) ?? "application/octet-stream",
                                      url: try container.decodeIfPresent(String.self, forKey: .url) ?? "",
                                      filename: try container.decodeIfPresent(String.self, forKey: .filename)))
            case "reasoning":
                part = .reasoning(try container.decodeIfPresent(String.self, forKey: .text) ?? "")
            case "data-orbi-message":
                // Fehlt `data` oder ist es kaputt, bleibt ein unbekannter Teil (nie ein Fehler).
                if let line = try? container.decodeIfPresent(OrbiLine.self, forKey: .data) { part = .orbiLine(line) } else { part = .other(type) }
            case "data-notice", "notice":
                if let body = try? container.decodeIfPresent(SystemNotice.Body.self, forKey: .data) ?? (try? SystemNotice.Body(from: decoder)),
                   let notice = body.notice { part = .notice(notice) } else { part = .other(type) }
            case "dynamic-tool":
                part = try tool(named: try container.decodeIfPresent(String.self, forKey: .toolName) ?? "Werkzeug")
            case _ where type.hasPrefix("tool-"):
                part = try tool(named: String(type.dropFirst(5)))
            default:
                part = .other(type)
            }
        }
    }
}

// Ein einzelner kaputter Teil verwirft nicht die ganze Liste.
private struct LenientPart: Decodable {
    let part: MessagePart?
    init(from decoder: any Decoder) throws { part = (try? ChatMessage.PartDTO(from: decoder))?.part }
}

extension MessagePart {
    // Teile aus freiem JSON (verschachtelte Nachricht einer Übergabe).
    static func list(from json: JSONValue?) -> [MessagePart] {
        guard let json, let data = try? JSONEncoder().encode(json),
              let parts = try? JSONDecoder().decode([LenientPart].self, from: data) else { return [] }
        return parts.compactMap(\.part)
    }
}

struct MessagesResponse: Decodable, Sendable {
    let messages: [ChatMessage]
    // Phase 3: Reaktionen des Chats; fehlen bei älteren Diensten, eine kaputte Zeile verwirft nicht die anderen.
    let reactions: [Reaction]
    // Phase 5: nach einem Neustart unterbrochene Arbeit dieses Chats („Unterbrochen – Weiter“); fehlt bei älteren Diensten.
    let interrupted: InterruptedInfo?
    // Nur bei seitenweiser Abfrage (`limit`): es gibt ältere Nachrichten vor dieser Seite.
    let hasMore: Bool

    private enum CodingKeys: String, CodingKey { case messages, reactions, interrupted, hasMore }
    private struct LenientReaction: Decodable {
        let value: Reaction?
        init(from decoder: any Decoder) throws { value = try? Reaction(from: decoder) }
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messages = try c.decode([ChatMessage].self, forKey: .messages)
        reactions = ((try? c.decodeIfPresent([LenientReaction].self, forKey: .reactions)) ?? nil)?.compactMap(\.value) ?? []
        interrupted = (try? c.decodeIfPresent(InterruptedInfo.self, forKey: .interrupted)) ?? nil
        hasMore = ((try? c.decodeIfPresent(Bool.self, forKey: .hasMore)) ?? nil) ?? false
    }
}

// Ein Chunk des Turn-Stroms (nur die genutzten Felder).
struct StreamChunk: Decodable, Sendable {
    let type: String
    let id: String?
    let delta: String?
    let messageId: String?
    let toolCallId: String?
    let toolName: String?
    let errorText: String?
    let approved: Bool?
    let approvalId: String?
    let input: JSONValue?
    let output: JSONValue?
    let preliminary: Bool?
    let messageMetadata: ChatMetadata?
    // Datenteile (`data-notice`): nur der Hinweis wird gelesen.
    let notice: SystemNotice?

    private enum CodingKeys: String, CodingKey {
        case type, id, delta, messageId, toolCallId, toolName, errorText, approved, approvalId, input, output, preliminary, messageMetadata, data
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        delta = try container.decodeIfPresent(String.self, forKey: .delta)
        messageId = try container.decodeIfPresent(String.self, forKey: .messageId)
        toolCallId = try container.decodeIfPresent(String.self, forKey: .toolCallId)
        toolName = try container.decodeIfPresent(String.self, forKey: .toolName)
        errorText = try container.decodeIfPresent(String.self, forKey: .errorText)
        approved = try container.decodeIfPresent(Bool.self, forKey: .approved)
        approvalId = try container.decodeIfPresent(String.self, forKey: .approvalId)
        input = try? container.decodeIfPresent(JSONValue.self, forKey: .input)
        output = try? container.decodeIfPresent(JSONValue.self, forKey: .output)
        preliminary = try? container.decodeIfPresent(Bool.self, forKey: .preliminary)
        messageMetadata = try? container.decodeIfPresent(ChatMetadata.self, forKey: .messageMetadata)
        notice = type == "data-notice" ? ((try? container.decodeIfPresent(SystemNotice.Body.self, forKey: .data)) ?? nil)?.notice : nil
    }
}

// Setzt aus den Chunks eines Turns die Antwort-Nachricht zusammen (Text läuft an, Werkzeuge wechseln den Zustand).
extension Array where Element == ChatMessage {
    // Ersetzt die Nachricht mit gleicher ID, sonst hängt sie an. Eine Wiedergabe beginnt leer: eine fertig gespeicherte Antwort bleibt
    // stehen, bis auch die Wiedergabe fertig ist (sonst verschwindet sie am Ende eines Turns kurz und baut sich neu auf).
    // Abgleich mit der neuesten Seite des Dienstes: ältere, schon geladene Nachrichten vor dem Seitenanfang bleiben, ab dort gilt die Seite.
    // Überlappen beide nicht (mehr Neues als eine Seite), gilt nur die Seite.
    // „abgebrochen“ kennt nur die App: die Markierung bleibt beim Abgleich (Chat wieder öffnen, Ereignis) an der Nachricht.
    func mergingLatest(_ latest: [ChatMessage]) -> [ChatMessage] {
        let stopped = Set(lazy.filter(\.stopped).map(\.id))
        let latest = stopped.isEmpty ? latest : latest.map { message in
            var message = message
            if stopped.contains(message.id) { message.stopped = true }
            return message
        }
        guard let first = latest.first, let index = firstIndex(where: { $0.id == first.id }) else { return latest }
        return Array(self[..<index]) + latest
    }

    mutating func upsert(_ message: ChatMessage) {
        // Von hinten suchen: beim Streamen ist es fast immer die letzte Nachricht.
        guard let index = lastIndex(where: { $0.id == message.id }) else { return append(message) }
        if self[index].metadata?.finishedAt != nil, message.metadata?.finishedAt == nil { return }
        self[index] = message
    }
}

struct MessageAssembler: Sendable {
    private(set) var message: ChatMessage?
    private(set) var errorText: String?
    private(set) var aborted = false
    private var textIndex: [String: Int] = [:]
    private var toolIndex: [String: Int] = [:]
    private var approvalTool: [String: String] = [:]

    // Gibt zurück, ob sich die Nachricht geändert hat.
    @discardableResult
    mutating func apply(_ chunk: StreamChunk) -> Bool {
        switch chunk.type {
        case "start":
            message = ChatMessage(id: chunk.messageId ?? UUID().uuidString, role: .assistant, parts: [], metadata: chunk.messageMetadata)
            textIndex = [:]
            toolIndex = [:]
            approvalTool = [:]
        case "text-start", "reasoning-start":
            let isText = chunk.type == "text-start"
            guard let id = chunk.id else { return false }
            ensureMessage()
            message?.parts.append(isText ? .text("") : .reasoning(""))
            textIndex[id] = (message?.parts.count ?? 1) - 1
        case "text-delta", "reasoning-delta":
            guard let id = chunk.id, let delta = chunk.delta, let index = textIndex[id] else { return false }
            switch message?.parts[index] {
            case .text(let text): message?.parts[index] = .text(text + delta)
            case .reasoning(let text): message?.parts[index] = .reasoning(text + delta)
            default: return false
            }
        case "tool-input-start", "tool-input-available":
            guard let id = chunk.toolCallId else { return false }
            ensureMessage()
            let state: ToolState = chunk.type == "tool-input-start" ? .inputStreaming : .inputAvailable
            if let index = toolIndex[id], case .tool(var tool) = message?.parts[index] {
                tool.state = state
                if let name = chunk.toolName { tool.name = name }
                if let input = chunk.input { tool.input = input }
                message?.parts[index] = .tool(tool)
            } else {
                message?.parts.append(.tool(ToolPart(toolCallId: id, name: chunk.toolName ?? "Werkzeug", state: state, input: chunk.input)))
                toolIndex[id] = (message?.parts.count ?? 1) - 1
            }
        case "tool-output-available":
            return setTool(chunk.toolCallId) { tool in
                tool.state = .outputAvailable
                tool.output = chunk.output
                tool.preliminary = chunk.preliminary ?? false
            }
        case "tool-output-error", "tool-input-error":
            return setTool(chunk.toolCallId) { tool in
                tool.state = .outputError
                tool.errorText = chunk.errorText
                if let input = chunk.input { tool.input = input }
            }
        case "tool-output-denied":
            return setTool(chunk.toolCallId) { $0.state = .outputDenied }
        case "tool-approval-request":
            // Die Antwort-Chunks tragen nur die Freigabe-ID: merken, zu welchem Werkzeug sie gehört.
            if let approvalId = chunk.approvalId, let toolCallId = chunk.toolCallId { approvalTool[approvalId] = toolCallId }
            return setTool(chunk.toolCallId) { tool in
                tool.state = .approvalRequested
                tool.approvalId = chunk.approvalId
            }
        case "tool-approval-response":
            return setTool(chunk.approvalId.flatMap { approvalTool[$0] } ?? chunk.toolCallId) { tool in
                tool.state = chunk.approved == false ? .outputDenied : .approvalResponded
            }
        case "message-metadata", "finish":
            guard let metadata = chunk.messageMetadata else { return false }
            var merged = message?.metadata ?? ChatMetadata()
            merged.merge(metadata)
            message?.metadata = merged
        case "error":
            errorText = chunk.errorText ?? "Die Antwort konnte nicht erstellt werden."
        case "data-notice":
            guard let notice = chunk.notice else { return false }
            ensureMessage()
            message?.parts.append(.notice(notice))
        case "abort":
            aborted = true
            message?.stopped = true
        default:
            return false
        }
        return true
    }

    private mutating func ensureMessage() {
        if message == nil { message = ChatMessage(id: UUID().uuidString, role: .assistant, parts: []) }
    }

    private mutating func setTool(_ toolCallId: String?, _ change: (inout ToolPart) -> Void) -> Bool {
        guard let toolCallId, let index = toolIndex[toolCallId], case .tool(var tool) = message?.parts[index] else { return false }
        change(&tool)
        message?.parts[index] = .tool(tool)
        return true
    }
}

// Turn-Strom außerhalb des Hauptthreads: dekodiert und setzt jeden Chunk sofort zusammen; die Anzeige holt höchstens einmal je Bild
// (`take`) die geänderten Nachrichten ab, statt bei jedem Chunk den ganzen Verlauf neu aufzubauen.
final class ChunkFeed: @unchecked Sendable {
    private let lock = NSLock()
    private let decoder = JSONDecoder()
    private var assembler = MessageAssembler()
    private var pending: [ChatMessage] = []
    private(set) var count = 0

    // Gibt zurück, ob der Text ein gültiger Chunk war.
    @discardableResult
    func ingest(_ data: String) -> Bool {
        guard let chunk = try? decoder.decode(StreamChunk.self, from: Data(data.utf8)) else { return false }
        lock.withLock {
            count += 1
            guard assembler.apply(chunk), let message = assembler.message else { return }
            // Beginnt im selben Bild eine neue Nachricht, bleibt die vorige mit ihrem letzten Stand erhalten.
            if pending.last?.id == message.id { pending[pending.count - 1] = message } else { pending.append(message) }
        }
        return true
    }

    // Seit dem letzten Abholen geänderte Nachrichten (je Nachricht der neueste Stand) und die Zahl aller Chunks.
    func take() -> (messages: [ChatMessage], count: Int) {
        lock.withLock { defer { pending = [] }; return (pending, count) }
    }

    var result: MessageAssembler { lock.withLock { assembler } }
}

// Token-Zeile im Info-Popover: „Eingabe 1.234 (Cache 1.000) · Ausgabe 56“; ohne Cache-Wert entfällt die Klammer.
enum TokenText {
    static func number(_ n: Int?) -> String { n.map { $0.formatted(.number.locale(Locale(identifier: "de_DE"))) } ?? "–" }
    static func line(input: Int?, cached: Int?, output: Int?) -> String {
        let cache = cached.map { " (Cache \(number($0)))" } ?? ""
        return "Eingabe \(number(input))\(cache) · Ausgabe \(number(output))"
    }
}
