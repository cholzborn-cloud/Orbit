import Foundation
import Security

// Phase 5: Jobs („Unterbrochen – Weiter“), Seitenleisten-Status, Einrichtung, Schlüssel, Tagesbudget, Heartbeat (plan/API.md, „Phase 5“).
// Alle Felder werden tolerant gelesen: eine Lücke oder ein falscher Typ verwirft nie die ganze Antwort. Schlüsselwerte kommen nie vom Dienst.

private struct Skip<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: any Decoder) throws { value = try? T(from: decoder) }
}

private extension KeyedDecodingContainer {
    func list<T: Decodable>(_ type: T.Type, _ key: Key) -> [T] {
        ((try? decodeIfPresent([Skip<T>].self, forKey: key)) ?? nil)?.compactMap(\.value) ?? []
    }
}

// MARK: Unterbrochen (Feld `interrupted` in GET /v1/chats/:id/messages)

struct InterruptedInfo: Decodable, Equatable, Sendable {
    let runId: String
    let at: Date?
    let steps: Int

    init(runId: String, at: Date? = nil, steps: Int = 0) { self.runId = runId; self.at = at; self.steps = steps }

    private enum CodingKeys: String, CodingKey { case runId, at, steps }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.lenientString(.runId), !id.isEmpty else {
            throw DecodingError.keyNotFound(CodingKeys.runId, .init(codingPath: decoder.codingPath, debugDescription: "runId fehlt"))
        }
        runId = id
        at = c.lenientDate(.at)
        steps = c.lenientInt(.steps) ?? 0
    }

    static let text = "Unterbrochen"
    static let hint = "Die Arbeit wurde beim Neustart angehalten."
}

// MARK: Seitenleisten-Status (GET /v1/status)

struct ChatStatusItem: Decodable, Equatable, Sendable {
    let chatId: String
    let working: Bool
    let needsYou: Bool
    let isNew: Bool
    let interrupted: Bool

    private enum CodingKeys: String, CodingKey { case chatId, working, needsYou, isNew, interrupted }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.lenientString(.chatId) else {
            throw DecodingError.keyNotFound(CodingKeys.chatId, .init(codingPath: decoder.codingPath, debugDescription: "chatId fehlt"))
        }
        chatId = id
        working = c.lenientBool(.working) ?? false
        needsYou = c.lenientBool(.needsYou) ?? false
        isNew = c.lenientBool(.isNew) ?? false
        interrupted = c.lenientBool(.interrupted) ?? false
    }

    init(chatId: String, working: Bool = false, needsYou: Bool = false, isNew: Bool = false, interrupted: Bool = false) {
        self.chatId = chatId; self.working = working; self.needsYou = needsYou; self.isNew = isNew; self.interrupted = interrupted
    }
}

struct ChatStatusResponse: Decodable, Equatable, Sendable {
    let chats: [ChatStatusItem]
    let needsYou: Int

    init(chats: [ChatStatusItem] = [], needsYou: Int = 0) { self.chats = chats; self.needsYou = needsYou }

    private enum CodingKeys: String, CodingKey { case chats, needsYou }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        chats = c.list(ChatStatusItem.self, .chats)
        needsYou = c.lenientInt(.needsYou) ?? chats.filter(\.needsYou).count
    }
}

// Wann die Seitenleiste einen blauen Punkt zeigt: arbeitet, braucht dich, neu (ungelesen), unterbrochen. Fehler und Ruhe: kein Punkt.
// Der Zustand aus den Ereignissen (Orbi-Figur) und der Stand aus dem Dienst (nach einem Neustart) ergänzen sich.
struct SidebarStatus: Equatable, Sendable {
    private(set) var newChats: Set<String> = []
    private(set) var interruptedChats: Set<String> = []
    private(set) var needsYouChats: Set<String> = []
    private(set) var needsYouCount = 0

    init() {}

    mutating func apply(_ response: ChatStatusResponse) {
        newChats = Set(response.chats.filter(\.isNew).map(\.chatId))
        interruptedChats = Set(response.chats.filter(\.interrupted).map(\.chatId))
        needsYouChats = Set(response.chats.filter(\.needsYou).map(\.chatId))
        needsYouCount = response.needsYou
    }

    mutating func seen(chatId: String) { newChats.remove(chatId) }
    mutating func resumed(chatId: String) { interruptedChats.remove(chatId) }

    enum Dot: Equatable { case done, needsYou }

    // Offener Chat: nie „neu“ (blauer Punkt), was dort ankommt, ist schon gesehen. „Braucht dich“ bleibt.
    func dot(chatIds: [String], state: OrbiState, openChatId: String? = nil) -> Dot? {
        if state == .waiting || chatIds.contains(where: { needsYouChats.contains($0) || interruptedChats.contains($0) }) { return .needsYou }
        if state == .working { return nil }
        if let openChatId, chatIds.contains(openChatId) { return nil }
        if state == .done || chatIds.contains(where: { newChats.contains($0) }) { return .done }
        return nil
    }
}

// MARK: Einrichtung (GET /v1/health?checks=1)

struct HealthCheck: Decodable, Identifiable, Equatable, Sendable {
    enum State: String, Sendable { case ok, fehlt, fehler }
    let id: String
    let label: String
    let state: State
    let fix: String?
    // Name des Schlüssels, den die App setzen kann (kein Wert).
    let key: String?
    let optional: Bool

    init(id: String, label: String, state: State, fix: String? = nil, key: String? = nil, optional: Bool = false) {
        self.id = id; self.label = label; self.state = state; self.fix = fix; self.key = key; self.optional = optional
    }

    private enum CodingKeys: String, CodingKey { case id, label, state, fix, key, optional }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.lenientString(.id), let label = c.lenientString(.label) else {
            throw DecodingError.keyNotFound(CodingKeys.id, .init(codingPath: decoder.codingPath, debugDescription: "id fehlt"))
        }
        self.id = id; self.label = label
        state = State(rawValue: c.lenientString(.state) ?? "") ?? .fehler
        fix = c.lenientString(.fix)
        key = c.lenientString(.key)
        optional = c.lenientBool(.optional) ?? false
    }
}

struct HealthResponse: Decodable, Sendable {
    let checks: [HealthCheck]
    private enum CodingKeys: String, CodingKey { case checks }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        checks = c.list(HealthCheck.self, .checks)
    }
}

// Mitteilungs-Erlaubnis prüft die App selbst (der Dienst kennt sie nicht). Gleiche Form wie ein Dienst-Check.
enum NotificationAccess: Sendable {
    case allowed, denied, undecided

    var check: HealthCheck {
        switch self {
        case .allowed: HealthCheck(id: "notifications", label: "Mitteilungen", state: .ok, optional: true)
        case .undecided: HealthCheck(id: "notifications", label: "Mitteilungen", state: .fehlt,
                                     fix: "Erlaube Mitteilungen, wenn Orbit dich bei Freigaben und fertigen Aufgaben rufen soll.", optional: true)
        case .denied: HealthCheck(id: "notifications", label: "Mitteilungen", state: .fehler,
                                  fix: "Mitteilungen sind aus. Schalte sie in den Systemeinstellungen unter Mitteilungen für Orbit ein.", optional: true)
        }
    }
}

// MARK: Schlüssel (GET /v1/keys, POST /v1/keys/reload)

struct KeyStatus: Decodable, Identifiable, Equatable, Sendable {
    let name: String
    let label: String
    let isSet: Bool
    let liveReload: Bool
    var id: String { name }

    private enum CodingKeys: String, CodingKey { case name, label, set, liveReload }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let name = c.lenientString(.name) else {
            throw DecodingError.keyNotFound(CodingKeys.name, .init(codingPath: decoder.codingPath, debugDescription: "name fehlt"))
        }
        self.name = name
        label = c.lenientString(.label) ?? name
        isSet = c.lenientBool(.set) ?? false
        liveReload = c.lenientBool(.liveReload) ?? true
    }

    init(name: String, label: String, isSet: Bool, liveReload: Bool = true) { self.name = name; self.label = label; self.isSet = isSet; self.liveReload = liveReload }
}

struct KeysResponse: Decodable, Sendable {
    let keys: [KeyStatus]
    let needsRestart: [String]
    private enum CodingKeys: String, CodingKey { case keys, needsRestart }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        keys = c.list(KeyStatus.self, .keys)
        needsRestart = ((try? c.decodeIfPresent([String].self, forKey: .needsRestart)) ?? nil) ?? []
    }
}

// Schreibt einen Schlüssel in den Schlüsselbund (Dienst `de.consti.orbit2`, Konto = Name der Umgebungsvariablen). Nur schreiben, nie lesen.
// Tests nutzen eine Attrappe und nie den echten Schlüsselbund.
protocol KeyStoring: Sendable {
    func save(name: String, value: String) -> Bool
}

struct SystemKeyStore: KeyStoring {
    static let service = "de.consti.orbit2"
    var service = SystemKeyStore.service

    func save(name: String, value: String) -> Bool {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
        let data = Data(value.utf8)
        let changed = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if changed == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
        }
        return changed == errSecSuccess
    }
}

// MARK: Tagesbudget (GET/PUT /v1/budget)

struct BudgetState: Decodable, Equatable, Sendable {
    struct Tokens: Decodable, Equatable, Identifiable, Sendable {
        let botId: String
        let turns: Int
        let totalTokens: Int
        var id: String { botId }
        private enum CodingKeys: String, CodingKey { case botId, turns, totalTokens }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard let id = c.lenientString(.botId) else {
                throw DecodingError.keyNotFound(CodingKeys.botId, .init(codingPath: decoder.codingPath, debugDescription: "botId fehlt"))
            }
            botId = id; turns = c.lenientInt(.turns) ?? 0; totalTokens = c.lenientInt(.totalTokens) ?? 0
        }
        init(botId: String, turns: Int, totalTokens: Int) { self.botId = botId; self.turns = turns; self.totalTokens = totalTokens }
    }

    enum JevState: String, Sendable { case ok, hinweis, aus }

    var jevDailyUsd: Double
    var maxSandboxes: Int
    var jevSpentUsd: Double
    var jevState: JevState
    var jevPercent: Int
    var sandboxesActive: Int
    var sandboxesWaiting: Bool
    var tokens: [Tokens]

    init(jevDailyUsd: Double = 0.5, maxSandboxes: Int = 3, jevSpentUsd: Double = 0, jevState: JevState = .ok, jevPercent: Int = 0,
         sandboxesActive: Int = 0, sandboxesWaiting: Bool = false, tokens: [Tokens] = []) {
        self.jevDailyUsd = jevDailyUsd; self.maxSandboxes = maxSandboxes; self.jevSpentUsd = jevSpentUsd; self.jevState = jevState
        self.jevPercent = jevPercent; self.sandboxesActive = sandboxesActive; self.sandboxesWaiting = sandboxesWaiting; self.tokens = tokens
    }

    private enum CodingKeys: String, CodingKey { case budget, jev, sandboxes, tokens }
    private enum BudgetKeys: String, CodingKey { case jevDailyUsd, maxSandboxes }
    private enum JevKeys: String, CodingKey { case spentUsd, state, percent }
    private enum SandboxKeys: String, CodingKey { case active, waiting }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let b = try? c.nestedContainer(keyedBy: BudgetKeys.self, forKey: .budget)
        jevDailyUsd = b?.lenientDouble(.jevDailyUsd) ?? 0.5
        maxSandboxes = b?.lenientInt(.maxSandboxes) ?? 3
        let j = try? c.nestedContainer(keyedBy: JevKeys.self, forKey: .jev)
        jevSpentUsd = j?.lenientDouble(.spentUsd) ?? 0
        jevState = JevState(rawValue: j?.lenientString(.state) ?? "") ?? .ok
        jevPercent = j?.lenientInt(.percent) ?? 0
        let s = try? c.nestedContainer(keyedBy: SandboxKeys.self, forKey: .sandboxes)
        sandboxesActive = s?.lenientInt(.active) ?? 0
        sandboxesWaiting = s?.lenientBool(.waiting) ?? false
        tokens = c.list(Tokens.self, .tokens)
    }
}

enum BudgetText {
    static func dollars(_ usd: Double) -> String {
        usd.formatted(.number.locale(Locale(identifier: "de_DE")).precision(.fractionLength(2))) + " $"
    }

    static func tokens(_ count: Int) -> String {
        count < 1000 ? "\(count)" : (Double(count) / 1000).formatted(.number.locale(Locale(identifier: "de_DE")).precision(.fractionLength(count < 10_000 ? 1 : 0))) + " Tsd."
    }

    // Hinweis ab 80 %, pausiert bei 100 %: nie das Wort „Limit“.
    static func jevNotice(_ state: BudgetState) -> String? {
        switch state.jevState {
        case .ok: nil
        case .hinweis: "Das Tagesbudget für Jev ist zu \(state.jevPercent) % verbraucht."
        case .aus: "Jev pausiert für heute. „Auto“ nimmt das Standardmodell des Orbis."
        }
    }

    static func sandboxNotice(_ state: BudgetState) -> String? {
        state.sandboxesWaiting ? "Neue Sandboxes warten, bis eine frei wird." : nil
    }
}

// MARK: Heartbeat (GET/PUT /v1/bots/:id/heartbeat)

struct HeartbeatState: Decodable, Equatable, Sendable {
    let enabled: Bool
    let everyMinutes: Int
    let from: String
    let to: String

    init(enabled: Bool, everyMinutes: Int = 30, from: String = "08:00", to: String = "22:00") {
        self.enabled = enabled; self.everyMinutes = everyMinutes; self.from = from; self.to = to
    }

    private enum CodingKeys: String, CodingKey { case enabled, everyMinutes, window }
    private enum WindowKeys: String, CodingKey { case from, to }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = c.lenientBool(.enabled) ?? false
        everyMinutes = c.lenientInt(.everyMinutes) ?? 30
        let w = try? c.nestedContainer(keyedBy: WindowKeys.self, forKey: .window)
        from = w?.lenientString(.from) ?? "08:00"
        to = w?.lenientString(.to) ?? "22:00"
    }
}

// MARK: Pfade

enum Phase5Paths {
    static func resume(chatId: String) -> String { "/v1/chats/\(MemoryPaths.segment(chatId))/resume" }
    static func seen(chatId: String) -> String { "/v1/chats/\(MemoryPaths.segment(chatId))/seen" }
    static func heartbeat(botId: String) -> String { "/v1/bots/\(MemoryPaths.segment(botId))/heartbeat" }
    static func memoryTrash(botId: String) -> String { "/v1/bots/\(MemoryPaths.segment(botId))/memory-trash" }
    static func restore(botId: String, name: String) -> String { "\(MemoryPaths.entry(botId: botId, name: name))/restore" }
    static let health = "/v1/health?checks=1"
    static let status = "/v1/status"
    static let keys = "/v1/keys"
    static let keysReload = "/v1/keys/reload"
    static let budget = "/v1/budget"
}
