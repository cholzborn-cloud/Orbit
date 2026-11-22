import Foundation

// Offene Freigaben und Rückfragen sowie Gruppenrunden, gespeist aus `GET /v1/events` (plan/API.md).
// Reine Logik ohne Netz und ohne Uhr.
struct PendingInteraction: Hashable, Sendable, Identifiable, Decodable {
    enum Kind: String, Decodable, Sendable { case approval, ask }

    let id: String
    let kind: Kind
    let chatId: String
    let botId: String
    let toolCallId: String
    let tool: String
    let input: JSONValue?
    let requestedAt: Date
    let expiresAt: Date
    // Phase 1: Grund (geld, veroeffentlichen, nachricht, loeschen, geheimnis, system, dauerhaft; Unbekanntes wird system), Schlüssel für „Immer“ und deutscher Satz; fehlen bei alten Diensten.
    var reason: String?
    var approvalKind: String?
    var text: String?
    // Lauf E: mehrzeiliger, ungekürzter Text unter dem Titel (z. B. Name/Plan/Aufgabe bei automation_create); optional.
    var detail: String?
    // Phase 2: Fragt ein Orbi, der nicht im Chat arbeitet, in dem Consti schrieb, tragen Rückfrage und Freigabe den Root-Chat und den Absender.
    var root: Root?
    var from: Sender?

    struct Root: Hashable, Sendable, Decodable { let chatId: String; let taskId: String? }
    struct Sender: Hashable, Sendable, Decodable {
        let id: String
        let name: String
        let avatar: String
        let color: String?
    }

    private enum CodingKeys: String, CodingKey { case id, kind, chatId, botId, toolCallId, tool, input, requestedAt, expiresAt, reason, approvalKind, text, detail, root, from }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(Kind.self, forKey: .kind)
        chatId = try c.decode(String.self, forKey: .chatId)
        botId = try c.decode(String.self, forKey: .botId)
        toolCallId = try c.decode(String.self, forKey: .toolCallId)
        tool = try c.decode(String.self, forKey: .tool)
        input = try? c.decodeIfPresent(JSONValue.self, forKey: .input)
        requestedAt = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .requestedAt) / 1000)
        expiresAt = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .expiresAt) / 1000)
        reason = ApprovalReason.normalized(try? c.decodeIfPresent(String.self, forKey: .reason))
        approvalKind = try? c.decodeIfPresent(String.self, forKey: .approvalKind)
        text = try? c.decodeIfPresent(String.self, forKey: .text)
        detail = try? c.decodeIfPresent(String.self, forKey: .detail)
        root = try? c.decodeIfPresent(Root.self, forKey: .root)
        from = try? c.decodeIfPresent(Sender.self, forKey: .from)
    }

    init(id: String, kind: Kind, chatId: String, botId: String, toolCallId: String, tool: String, input: JSONValue?, requestedAt: Date, expiresAt: Date,
         root: Root? = nil, from: Sender? = nil) {
        self.id = id; self.kind = kind; self.chatId = chatId; self.botId = botId; self.toolCallId = toolCallId
        self.tool = tool; self.input = input; self.requestedAt = requestedAt; self.expiresAt = expiresAt
        self.root = root; self.from = from
    }

    // Chat, in dem die Karte steht und beantwortet wird: der Root-Chat, sonst der eigene Chat des fragenden Orbis.
    var displayChatId: String { root?.chatId ?? chatId }
}

// Stand einer Gruppenrunde (Ereignis `group-turn`): läuft von `start` bis `end`; `end` ist das verlässliche Ende.
struct GroupRound: Hashable, Sendable {
    var active: Bool
    var stopped: Bool
}

struct InteractionBoard: Equatable, Sendable {
    private(set) var pending: [String: PendingInteraction] = [:]
    // Zuletzt entschiedene Freigaben/Rückfragen (Status: approved, denied, expired, aborted, answered): Anzeige nach dem Verfall.
    private(set) var resolved: [String: String] = [:]
    private(set) var rounds: [String: GroupRound] = [:]
    // Freigaben, die mit „Immer erlauben“ entschieden wurden (Karte: „Immer erlaubt“).
    private(set) var alwaysApproved: Set<String> = []

    private struct Event: Decodable {
        let type: String
        let status: String?
        let approvals: [Lenient]?
        let chatId: String?
        let phase: String?
        let stopped: Bool?
        let always: Bool?
    }

    // Eine einzelne kaputte Interaktion im Snapshot verwirft nicht alle anderen.
    private struct Lenient: Decodable {
        let value: PendingInteraction?
        init(from decoder: any Decoder) throws { value = try? PendingInteraction(from: decoder) }
    }

    // Die Zeile ist ein Ereignis; unbekannte oder kaputte Zeilen ändern nichts.
    mutating func apply(line: Data) {
        guard let event = try? JSONDecoder().decode(Event.self, from: line) else { return }
        switch event.type {
        case "snapshot":
            pending = Dictionary((event.approvals ?? []).compactMap(\.value).map { ($0.id, $0) }, uniquingKeysWith: { $1 })
            rounds = [:]
        case "approval", "question":
            // Die Ereigniszeile trägt die ganze Interaktion plus Status.
            guard let interaction = try? JSONDecoder().decode(PendingInteraction.self, from: line), let status = event.status else { return }
            if status == "pending" {
                pending[interaction.id] = interaction
            } else {
                pending[interaction.id] = nil
                if resolved.count > 200 { resolved.removeAll(); alwaysApproved.removeAll() }
                resolved[interaction.id] = status
                if status == "approved", event.always == true { alwaysApproved.insert(interaction.id) }
            }
        case "group-turn":
            guard let chatId = event.chatId, let phase = event.phase else { return }
            switch phase {
            case "start": rounds[chatId] = GroupRound(active: true, stopped: false)
            case "end": rounds[chatId] = GroupRound(active: false, stopped: event.stopped == true)
            default: if rounds[chatId] == nil { rounds[chatId] = GroupRound(active: true, stopped: false) }
            }
        case "orbi-message":
            break  // gespeicherte Zeile: der Verlauf wird neu geladen (`historyChat(in:)`), hier gibt es nichts zu merken
        default:
            break
        }
    }

    // Ergänzt offene Freigaben aus `GET /v1/approvals` (nur hinzufügen, nie entfernen: der Strom ist die Wahrheit).
    mutating func merge(approvals: [PendingInteraction]) {
        for item in approvals where pending[item.id] == nil && resolved[item.id] == nil { pending[item.id] = item }
    }

    // Chat, dessen gespeicherter Verlauf sich geändert hat (Ereignisse `orbi-message` und `group-turn`); nil = keiner.
    static func historyChat(in line: Data) -> String? {
        guard let event = try? JSONDecoder().decode(Event.self, from: line), let chatId = event.chatId else { return nil }
        return event.type == "orbi-message" || event.type == "group-turn" ? chatId : nil
    }

    // Läuft im Gruppenchat gerade eine Runde (der Chat ist belegt, neue Turns gäben 409)?
    func isRoundActive(chatId: String) -> Bool { rounds[chatId]?.active == true }
    // Die letzte Runde wurde gestoppt (Anzeige „gestoppt“, bis die nächste beginnt).
    func wasRoundStopped(chatId: String) -> Bool { rounds[chatId].map { !$0.active && $0.stopped } ?? false }

    // Karten von Orbis, die im Auftrag dieses Chats arbeiten, aber nicht hier: Rückfragen und Freigaben mit Absender, älteste zuerst.
    // Hinfällige (aborted/expired) sind nicht mehr in `pending` und erscheinen nicht.
    func rootCards(forChat chatId: String) -> [PendingInteraction] {
        pending.values.filter { $0.root?.chatId == chatId && $0.chatId != chatId }.sorted { ($0.requestedAt, $0.id) < ($1.requestedAt, $1.id) }
    }

    func pending(forChat chatId: String) -> [PendingInteraction] {
        pending.values.filter { $0.chatId == chatId }.sorted { $0.requestedAt < $1.requestedAt }
    }

    // Offene Rückfrage zu einem Werkzeugaufruf (die Rückfrage-ID ist die Werkzeug-ID).
    func question(toolCallId: String) -> PendingInteraction? { pending[toolCallId].flatMap { $0.kind == .ask ? $0 : nil } }

    var hasOpen: Bool { !pending.isEmpty }
}
