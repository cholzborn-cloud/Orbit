import Foundation
import Observation

// Zustand der Orbis aus `GET /v1/events` (plan/API.md): erstes Ereignis ist der Snapshot, danach live.
// Reine Logik ohne Netz und ohne Uhr, damit sie sich testen lässt.
struct OrbiStatusBoard: Equatable, Sendable {
    struct Entry: Equatable, Sendable {
        var botId: String
        var state: OrbiState
        var since: Date
    }

    // „fertig“ bleibt, bis der Chat geöffnet wird (`acknowledge`); „Fehler“ bleibt eine Minute oder bis zum nächsten Ereignis dieses Chats.
    static let errorSeconds = 60.0

    private(set) var chats: [String: Entry] = [:]

    mutating func apply(line: Data, now: Date) {
        guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = json["type"] as? String else { return }
        switch type {
        case "snapshot":
            chats = [:]
            for item in json["working"] as? [[String: Any]] ?? [] { set(item, now: now) }
        case "status":
            set(json, now: now)
        default:
            break  // approval/question/automation: der Status kommt zusätzlich als `status`
        }
    }

    private mutating func set(_ item: [String: Any], now: Date) {
        guard let chatId = item["chatId"] as? String, let botId = item["botId"] as? String,
              let status = item["status"] as? String, let state = OrbiState(service: status) else { return }
        if state == .calm { chats[chatId] = nil } else { chats[chatId] = Entry(botId: botId, state: state, since: now) }
    }

    mutating func prune(now: Date) {
        chats = chats.filter { _, entry in
            switch entry.state {
            case .error: now.timeIntervalSince(entry.since) < Self.errorSeconds
            default: true
            }
        }
    }

    // Nächster Zeitpunkt, an dem ein Eintrag verfällt (nil = keiner).
    var nextExpiry: Date? {
        chats.values.compactMap { entry -> Date? in
            switch entry.state {
            case .error: entry.since.addingTimeInterval(Self.errorSeconds)
            default: nil
            }
        }.min()
    }

    func state(forChat chatId: String) -> OrbiState { chats[chatId]?.state ?? .calm }

    // Chat geöffnet: „fertig“ ist gesehen.
    mutating func acknowledge(chatId: String) {
        if chats[chatId]?.state == .done { chats[chatId] = nil }
    }

    // Mehrere Chats desselben Orbis: der wichtigste Zustand gewinnt.
    func state(forBot botId: String) -> OrbiState {
        chats.values.filter { $0.botId == botId }.map(\.state).max { $0.priority < $1.priority } ?? .calm
    }
}

@MainActor @Observable
final class EventsStore {
    private(set) var board = OrbiStatusBoard()
    private(set) var interactions = InteractionBoard()
    // Phase 3: laufende Schritte je Chat für die Statusleiste (`status-step`, Snapshot `steps`).
    private(set) var steps = StepBoard()
    // Hintergrund-Helfer je Chat (Snapshot `tasks`, Ereignis `task`): eigene Zeilen mit Stopp unter der Live-Zeile.
    private(set) var tasks = TaskBoard()
    // Lauf D: kurze Systemzeile je Chat (Wiederholung, Handlungsbedarf).
    private(set) var notices = NoticeBoard()
    // Reaktion gesetzt oder entfernt (chatId, messageId, actor, emoji; nil = entfernt) und Onboarding fertig (botId, Anweisung ergänzt).
    @ObservationIgnored var onReaction: ((String, String, String, String?) -> Void)?
    @ObservationIgnored var onOnboarding: ((String, Bool) -> Void)?
    // Ereignis `orbis-created`: der Hauptorbi hat im Onboarding Orbis angelegt, die Liste neu laden.
    @ObservationIgnored var onOrbisCreated: (() -> Void)?
    @ObservationIgnored var onRemindersPending: (() -> Void)?
    @ObservationIgnored var onReminderCancelled: ((String) -> Void)?
    private(set) var connected = false
    // Phase 5: Stand der Seitenleiste aus dem Dienst („neu“, „unterbrochen“, Zahl „braucht dich“); überlebt einen Neustart des Dienstes.
    private(set) var sidebar = SidebarStatus()
    private var statusRefresh: Task<Void, Never>?
    // Laufende Automationen (Snapshot + live), Schlüssel = Automation. Fertige verschwinden hier und gehen an `onAutomationFinished`.
    private(set) var automations: [String: AutomationEvent] = [:]
    @ObservationIgnored var onAutomationFinished: ((AutomationEvent) -> Void)?
    // Zweiter Zuhörer für fertige Läufe (Mitteilungen), unabhängig vom ersten (Liste „Geplant“).
    @ObservationIgnored var onAutomationDone: ((AutomationEvent) -> Void)?
    // Nach jedem verarbeiteten Ereignis (Mitteilungen prüfen offene Freigaben und Rückfragen).
    @ObservationIgnored var onApplied: (() -> Void)?
    // Ein Chat wurde (von außen) aktiv oder fertig: Automation, Übergabe, anderes Fenster. `working` = arbeitet gerade.
    @ObservationIgnored var onChatChanged: ((String, Bool) -> Void)?
    // Ist dieser Chat gerade im Fenster offen? Dann gilt „fertig“/„neu“ sofort als gesehen (auch im Dienst).
    @ObservationIgnored var isOpen: ((String) -> Bool)?
    // Der gespeicherte Verlauf eines Chats hat sich geändert (Ereignisse `orbi-message` und `group-turn`): neu laden.
    @ObservationIgnored var onHistoryChanged: ((String) -> Void)?
    private let client: ServiceClient
    private var loop: Task<Void, Never>?
    private var expiry: Task<Void, Never>?

    init(client: ServiceClient) { self.client = client }

    // Nur für die unsichtbare Design-Abnahme mit künstlichen Daten.
    func simulate(status: ChatStatusResponse, events: Data) {
        sidebar.apply(status)
        board.apply(line: events, now: .now)
    }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        statusRefresh?.cancel(); statusRefresh = nil
        loop?.cancel(); loop = nil
        expiry?.cancel(); expiry = nil
        connected = false
    }

    // Verbindet, liest bis zum Abbruch und verbindet nach kurzer Pause neu (liefert wieder einen Snapshot).
    private func run() async {
        var pause = 1.0
        while !Task.isCancelled {
            do {
                let request = try client.eventsRequest()
                _ = try await client.stream(request) { [weak self] event in
                    guard let self else { return }
                    // Nach dem Verbinden zusätzlich die offenen Freigaben abholen (Neustart der App).
                    if !connected { Task { await self.refreshApprovals(); await self.refreshStatus() } }
                    connected = true
                    pause = 1
                    apply(Data(event.data.utf8))
                }
            } catch {
                // Dienst weg oder Verbindung zu langsam: unten neu versuchen.
            }
            connected = false
            try? await Task.sleep(for: .seconds(pause))
            pause = min(pause * 2, 10)
        }
    }

    func apply(_ data: Data, now: Date = .now) {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = json["type"] as? String {
            if type == "reminders-pending" || type == "snapshot" { onRemindersPending?() }
            if type == "reminders-cancelled", let id = json["id"] as? String { onReminderCancelled?(id) }
        }
        applyAutomations(data)
        var next = board
        next.apply(line: data, now: now)
        let before = board.chats.mapValues(\.state)
        update(next, now: now)
        for chatId in Set(before.keys).union(next.chats.keys) {
            let was = before[chatId] ?? .calm, now = next.chats[chatId]?.state ?? .calm
            if was != now, was == .working || now == .working || now == .done { onChatChanged?(chatId, now == .working) }
            if was != now, now == .done, isOpen?(chatId) == true { acknowledge(chatId: chatId) }
        }
        var nextInteractions = interactions
        nextInteractions.apply(line: data)
        if nextInteractions != interactions { interactions = nextInteractions }
        if let chatId = InteractionBoard.historyChat(in: data) { onHistoryChanged?(chatId) }
        var nextSteps = steps
        nextSteps.apply(line: data)
        if nextSteps != steps { steps = nextSteps }
        var nextTasks = tasks
        nextTasks.apply(line: data)
        if nextTasks != tasks { tasks = nextTasks }
        var nextNotices = notices
        nextNotices.apply(line: data)
        if nextNotices != notices { notices = nextNotices }
        if let event = ReactionBoard.event(from: data) { onReaction?(event.chatId, event.messageId, event.actor, event.emoji) }
        if let event = OnboardingEvent.parse(data), event.done { onOnboarding?(event.botId, event.instructions) }
        if OnboardingEvent.isOrbisCreated(data) { onOrbisCreated?() }
        if Self.endsWork(data) { scheduleStatusRefresh() }
        onApplied?()
    }

    private func applyAutomations(_ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = json["type"] as? String else { return }
        switch type {
        case "snapshot":
            let active = (json["automations"] as? [[String: Any]] ?? []).compactMap(AutomationEvent.init(json:)).filter { $0.status.isActive }
            automations = Dictionary(active.map { ($0.automationId, $0) }, uniquingKeysWith: { $1 })
        case "automation":
            guard let event = AutomationEvent(json: json) else { return }
            if event.status.isActive { automations[event.automationId] = event }
            else {
                let wasActive = automations.removeValue(forKey: event.automationId) != nil
                if wasActive || event.status == .ok || event.status == .error { onAutomationFinished?(event); onAutomationDone?(event) }
            }
        default: break
        }
    }

    // Offene Freigaben nach einem Neustart der App noch einmal aus dem Dienst holen (zusätzlich zum Snapshot).
    func refreshApprovals() async {
        guard let approvals = try? await client.approvals() else { return }
        var next = interactions
        next.merge(approvals: approvals)
        if next != interactions { interactions = next }
    }

    func acknowledge(chatId: String) {
        let wasDone = board.chats[chatId]?.state == .done
        var next = board
        next.acknowledge(chatId: chatId)
        update(next, now: .now)
        // Gesehen auch im Dienst vermerken, damit „neu“ nach einem Neustart nicht wiederkommt.
        if wasDone || sidebar.newChats.contains(chatId) {
            sidebar.seen(chatId: chatId)
            let client = client
            Task { try? await client.markSeen(chatId: chatId) }
        }
    }

    func refreshStatus() async {
        guard let response = try? await client.chatStatus() else { return }
        var next = sidebar
        next.apply(response)
        if next != sidebar { sidebar = next }
        // Der Dienst kennt den offenen Chat nicht: was dort neu ist, sofort als gesehen vermerken.
        for chatId in sidebar.newChats where isOpen?(chatId) == true { acknowledge(chatId: chatId) }
    }

    // Nach dem Ende einer Arbeit den Stand aus dem Dienst holen (kurz gebündelt).
    private func scheduleStatusRefresh() {
        statusRefresh?.cancel()
        statusRefresh = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.refreshStatus()
        }
    }

    private static func endsWork(_ data: Data) -> Bool {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["type"] as? String == "status",
              let status = json["status"] as? String else { return false }
        return ["fertig", "fehler", "ruhig"].contains(status)
    }

    // Stopp-Knopf eines Helfers: sofort ausblenden, der Dienst bricht ab und meldet `task` (stopped).
    func stopHelper(id: String) {
        tasks.remove(id: id)
        let client = client
        Task { try? await client.stopTask(id: id) }
    }

    func chatResumed(_ chatId: String) { sidebar.resumed(chatId: chatId) }

    // Zahl für die Menüleiste: offene Freigaben und Rückfragen (live) oder, nach einem Neustart, der Stand aus dem Dienst.
    var needsYouCount: Int { max(interactions.pending.count, sidebar.needsYouCount) }

    private func update(_ next: OrbiStatusBoard, now: Date) {
        guard next != board else { return }
        board = next
        scheduleExpiry()
    }

    // Lässt „fertig“ und „Fehler“ zur rechten Zeit verfallen, ohne zu takten.
    private func scheduleExpiry() {
        expiry?.cancel()
        guard let at = board.nextExpiry else { return }
        expiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0.05, at.timeIntervalSinceNow)))
            guard !Task.isCancelled, let self else { return }
            var next = board
            next.prune(now: .now)
            update(next, now: .now)
        }
    }
}
