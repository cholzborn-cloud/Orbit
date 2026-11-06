import Foundation
import Observation

// Hält Client, Dienstprozess und Stores; gemeinsamer Einstieg für Fenster, Selbsttest und Screenshot.
@MainActor @Observable
final class AppModel {
    let client: ServiceClient
    let service: ServiceProcess
    let botStore: BotStore
    let chatStore: ChatStore
    let events: EventsStore
    let reminders: ReminderWorker
    let cards: CardCenter
    let settings: SettingsStore
    let automations: AutomationStore
    let desktops: DesktopStore
    let search: SearchStore
    // Menüs, Rechtsklick-Menüs, Tooltips und Hover-Karten im Web-Stil (Ebene über dem Fenster).
    let overlay = OverlayCenter()
    // Nur Screenshot-Szenen: öffnet ein benanntes Menü oder einen Tooltip (z. B. „menu-plus“), sobald es sichtbar ist.
    var screenAction: String?
    // Nur Screenshot-Szenen: Reiter des Seitenpanels beim Öffnen („desktop“ = Computer).
    var screenTab: String?
    var selection: Selection?
    var sheet: Sheet?
    // Name für den Dialog „Neuer Skill“ (`/skill neu <name>` im Composer); nil = geschlossen.
    var newSkillName: String?
    // Computer eines Orbis im Vollbild (Orbi-Kennung); nil = zu.
    var desktopFullscreen: String?
    // Seitenleiste eingeklappt (Web: SidebarProvider, Cookie sidebar_state, ⌘B), gemerkt über Neustarts.
    // S36: Einstellungsfenster offen (setzt OrbitApp); der Fuß der Seitenleiste leuchtet dann.
    var settingsOpen = false
    var sidebarCollapsed = UserDefaults.standard.bool(forKey: "sidebar-collapsed")

    // Breite der ausgeklappten Seitenleiste: per Ziehen am Rand änderbar (220…480), schließt sich dabei nie; gemerkt über Neustarts.
    static let sidebarWidthRange: ClosedRange<CGFloat> = Theme.Layout.sidebarMin...Theme.Layout.sidebarMax
    var sidebarWidth: CGFloat = {
        let v = UserDefaults.standard.double(forKey: "sidebar-width")
        return v > 0 ? min(max(CGFloat(v), sidebarWidthRange.lowerBound), sidebarWidthRange.upperBound) : Theme.Layout.sidebar
    }()
    func setSidebarWidth(_ w: CGFloat) {
        sidebarWidth = min(max(w, Self.sidebarWidthRange.lowerBound), Self.sidebarWidthRange.upperBound)
        UserDefaults.standard.set(Double(sidebarWidth), forKey: "sidebar-width")
    }

    // Letzte Aktivität je Chat (lokal, sofort): Senden, Arbeitsbeginn und -ende. Der Dienst liefert `lastMessageAt` erst beim Neuladen.
    private(set) var activity: [String: Date] = [:]
    func touch(chatId: String) { activity[chatId] = .now }
    func lastActivity(_ bot: Bot) -> Date { max(bot.lastMessageAt, activity[bot.chatId] ?? .distantPast) }
    // Zuletzt aktive zuerst; bei gleichem Zeitpunkt bleibt die Reihenfolge des Dienstes.
    func byRecency(_ bots: [Bot]) -> [Bot] {
        bots.enumerated().sorted { a, b in
            let l = lastActivity(a.element), r = lastActivity(b.element)
            return l == r ? a.offset < b.offset : l > r
        }.map(\.element)
    }

    // Hauptorbi öffnen (Start und Wiederöffnen des Fensters); ohne Hauptorbi der erste.
    func selectMain() {
        guard let bot = botStore.main ?? botStore.orbis.first else { return }
        selection = .bot(bot.id)
    }

    // Beim Öffnen des Fensters: Hauptorbi wählen, außer eine Mitteilung hat gerade einen anderen Chat angefordert.
    func windowOpened() {
        if holdSelection { holdSelection = false; return }
        selectMain()
    }
    @ObservationIgnored var holdSelection = false

    func toggleSidebar() {
        sidebarCollapsed.toggle()
        UserDefaults.standard.set(sidebarCollapsed, forKey: "sidebar-collapsed")
    }
    // Rechtes Panel (Web: ChatSidePanel/GroupSidePanel): für alle Chats gleich, Breite wird beim Schließen gemerkt.
    var panelOpen = false
    var panelWidth: CGFloat = AppModel.storedPanelWidth()
    // Zeitpunkt des letzten Umschaltens: der Chat-Kopf rastet danach kurz nicht ein (Umbruch verschiebt den Scroll).
    private(set) var panelToggledAt = Date.distantPast
    static let panelDefaultWidth: CGFloat = Theme.Metrics.pt320   // Figma Bildschirm 1 (148:90637): Panel 320
    static let panelMaxWidth: CGFloat = 520
    private static let panelWidthKey = "orbit-side-panel-width"

    static func storedPanelWidth() -> CGFloat {
        let stored = UserDefaults.standard.double(forKey: panelWidthKey)
        return stored > 0 ? min(stored, panelMaxWidth) : panelDefaultWidth
    }

    func togglePanel() {
        if panelOpen { UserDefaults.standard.set(Double(panelWidth.rounded()), forKey: Self.panelWidthKey) }
        else { panelWidth = Self.storedPanelWidth() }
        panelToggledAt = .now
        panelOpen.toggle()
    }

    // Rechtsklick „Bearbeiten“: Chat öffnen und das Panel zeigen (wie die Pille im Web).
    func edit(_ target: Selection) {
        selection = target
        if !panelOpen { togglePanel() }
    }
    // Chat zu einer Chat-ID öffnen (Direktchat eines Orbis oder Gruppe); optional an einer Nachricht (Suchtreffer, Lauf).
    // Gibt false zurück, wenn es den Chat nicht (mehr) gibt.
    @discardableResult
    func openChat(_ chatId: String, messageId: String? = nil, botId: String? = nil) -> Bool {
        let target: Selection
        if let bot = botStore.orbis.first(where: { $0.chatId == chatId }) { target = .bot(bot.id) }
        else if botStore.groups.contains(where: { $0.id == chatId }) { target = .group(chatId) }
        else if let botId, botStore.bot(id: botId) != nil { target = .run(chatId: chatId, botId: botId) }
        else { return false }
        selection = target
        if let messageId { chatStore.session(for: chatId).jump(to: messageId) }
        return true
    }

    // Treffer der Suche öffnen: Chat an der Nachricht. Gibt es den Chat nicht mehr (gelöscht), bleibt die Suche mit Hinweis offen.
    func openSearchHit(_ index: Int) {
        guard search.results.indices.contains(index) else { return }
        let hit = search.results[index]
        if openChat(hit.chatId, messageId: hit.messageId) { search.reset() }
        else { search.openError = "Dieser Chat existiert nicht mehr." }
    }

    // Fehler beim Löschen/Leeren (steht in der Bestätigung als Hinweis).
    var deleteError: String?
    private(set) var deleteBusy = false
    private(set) var startupError: String?
    // `start()` läuft einmal je App-Start (Fenster und Menüleistensymbol lösen es beide aus).
    var booted = false

    // Offener Dialog (Anlegen, Bearbeiten, Anpassen).
    enum Sheet: Identifiable, Equatable {
        case newBot
        case editBot(id: String, tab: BotEditorModel.Tab)
        case newGroup

        var id: String {
            switch self {
            case .newBot: "new-bot"
            case .editBot(let id, let tab): "bot-\(id)-\(tab.rawValue)"
            case .newGroup: "new-group"
            }
        }
    }

    enum Selection: Hashable {
        case bot(String)
        case group(String)
        // Chat eines Automations-Laufs („neuer Chat je Lauf“): steht in keiner Liste, gehört aber zu einem Orbi.
        case run(chatId: String, botId: String)
    }

    init(client: ServiceClient = ServiceClient()) {
        self.client = client
        service = ServiceProcess(client: client)
        botStore = BotStore(client: client)
        chatStore = ChatStore(client: client)
        events = EventsStore(client: client)
        reminders = ReminderWorker(service: client)
        cards = CardCenter(client: client, events: events)
        settings = SettingsStore(client: client)
        automations = AutomationStore(client: client, events: events)
        search = SearchStore(client: client)
        desktops = DesktopStore(client: client)
        LimitStore.shared.client = client
        settings.onSkillsChanged = { [chatStore] in chatStore.reloadSkills() }
        settings.botNames = { [botStore] in Dictionary(botStore.orbis.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first }) }
        chatStore.onResumed = { [events] chatId in events.chatResumed(chatId) }
        chatStore.onActivity = { [weak self] chatId in self?.touch(chatId: chatId) }
        events.isOpen = { [weak self] chatId in self?.openChatId == chatId }
        events.onChatChanged = { [weak self, chatStore] chatId, working in
            self?.touch(chatId: chatId)
            if !working { Task { await self?.botStore.load(silent: true) } }   // `lastMessageAt` vom Dienst nachziehen
            guard let session = chatStore.existingSession(for: chatId) else { return }
            Task { await session.sync(live: working) }
        }
        // Phase 3: Reaktionen live; Onboarding fertig oder übersprungen: Orbis neu laden (ergänzte Anweisung), Hinweis im Chat weg.
        events.onReaction = { [chatStore] chatId, messageId, actor, emoji in
            chatStore.existingSession(for: chatId)?.applyReaction(messageId: messageId, actor: actor, emoji: emoji)
        }
        events.onOnboarding = { [weak self, chatStore] botId, _ in
            guard let self else { return }
            if let bot = botStore.bot(id: botId) { chatStore.existingSession(for: bot.chatId)?.onboardingFinished() }
            Task { await self.botStore.load(silent: true) }
        }
        events.onOrbisCreated = { [weak self] in Task { await self?.botStore.load(silent: true) } }
        // Zeilen „gesendet an/von“ und Antworten einer Gruppenrunde sind gespeichert: Verlauf des Chats nachladen.
        events.onRemindersPending = { [weak reminders] in Task { await reminders?.drain() } }
        events.onReminderCancelled = { [weak reminders] id in reminders?.cancel(id) }
        events.onHistoryChanged = { [chatStore] chatId in
            guard let session = chatStore.existingSession(for: chatId) else { return }
            Task { await session.sync() }
        }
    }

    func start() async {
        startupError = nil
        do {
            try await service.ensureRunning()
            await botStore.load()
            if selection == nil { selectMain() }
            await chatStore.load()
            events.start()
            await settings.loadTheme()
            await automations.refreshUnread()
            markFirstRunDoneIfOrbisExist()
        } catch {
            startupError = error.localizedDescription
        }
    }

    // Erststart: erst die Einrichtung (Schritt „Alles bereit?“), dann das Onboarding mit dem ersten Orbi. Beides läuft nur einmal;
    // wer schon Orbis hat (auch von einer älteren Version), sieht es nie. „Ersten Orbi erstellen“ in der Mitte gibt es nur, wenn
    // alle Orbis gelöscht wurden. Nie in Testkopien.
    var wantsSetupIntro = false
    var setupIntroDone = UserDefaults.standard.bool(forKey: AppModel.setupDoneKey)
    var creatingFirstOrbi = false
    // Erster leerer Start: Onboarding statt Seitenleiste und Detail.
    var showsOnboarding: Bool {
        if creatingFirstOrbi && !onboardingDone { return true }
        if case .loaded = botStore.state, botStore.orbis.isEmpty, botStore.groups.isEmpty, !onboardingDone { return true }
        return false
    }
    var onboardingDone = UserDefaults.standard.bool(forKey: AppModel.onboardingDoneKey)
    private static let setupDoneKey = "firstRun.setupDone"
    private static let onboardingDoneKey = "firstRun.onboardingDone"

    func finishSetupIntro() {
        setupIntroDone = true
        UserDefaults.standard.set(true, forKey: Self.setupDoneKey)
    }

    func finishOnboarding() {
        finishSetupIntro()
        onboardingDone = true
        UserDefaults.standard.set(true, forKey: Self.onboardingDoneKey)
    }

    // Wer Orbis hat, hat die Einrichtung hinter sich.
    private func markFirstRunDoneIfOrbisExist() {
        guard !botStore.orbis.isEmpty || !botStore.groups.isEmpty, !onboardingDone else { return }
        finishOnboarding()
    }

    // Einrichtung öffnen: Prüfungen laden, bevor der Schritt erscheint.
    func loadSetupIntro() async { await settings.setup.load() }

    // MARK: Orbis und Gruppen speichern und löschen

    // Speichert den Orbi-Dialog; bei Erfolg schließt er und der neue Orbi ist ausgewählt. Fehler stehen im Dialog.
    func save(_ editor: BotEditorModel) async {
        editor.error = nil
        if let message = editor.validationMessage { editor.error = message; return }
        editor.saving = true
        defer { editor.saving = false }
        do {
            if let bot = editor.editing {
                try await botStore.update(id: bot.id, editor.form)
            } else {
                let created = try await botStore.create(editor.form)
                selection = .bot(created.id)
                sheet = nil
                startOnboarding(botId: created.id, chatId: created.chatId)
                return
            }
            sheet = nil
        } catch {
            editor.error = error.localizedDescription
        }
    }

    // Phase 3: Der neue Orbi stellt sich vor (einmaliger Turn mit `onboarding: true`). Fehlt die Chat-ID, kommt sie aus der neu geladenen Liste.
    func startOnboarding(botId: String, chatId: String?) {
        Task {
            var chat = chatId
            if chat == nil { await botStore.load(silent: true); chat = botStore.bot(id: botId)?.chatId }
            // Nur wenn der Dienst das Onboarding als offen meldet (ältere Dienste kennen es nicht).
            guard let chat, botStore.bot(id: botId)?.onboardingDone == false else { return }
            await chatStore.session(for: chat).startOnboarding(botId: botId)
        }
    }

    func save(_ editor: GroupEditorModel) async {
        editor.error = nil
        if let message = editor.validationMessage { editor.error = message; return }
        editor.saving = true
        defer { editor.saving = false }
        do {
            if let group = editor.editing {
                try await botStore.updateGroup(id: group.id, name: editor.trimmedName, botIds: editor.memberIds)
            } else {
                selection = .group(try await botStore.createGroup(name: editor.trimmedName, botIds: editor.memberIds))
            }
            sheet = nil
        } catch {
            editor.error = error.localizedDescription
        }
    }

    // Bestätigtes Löschen: danach Auswahl und Chat-Sitzung aufräumen. Fehler als Text (nie still).
    func confirmDelete(_ target: PendingDelete? = nil) async {
        guard !deleteBusy else { return }
        deleteBusy = true
        defer { deleteBusy = false }
        deleteError = nil
        do {
            switch try await botStore.confirmDelete(target) {
            case .bot(let bot):
                if selection == .bot(bot.id) { selection = nil }
                chatStore.remove(chatId: bot.chatId)
                desktops.remove(botId: bot.id)
                if desktopFullscreen == bot.id { desktopFullscreen = nil }
            case .group(let group):
                if selection == .group(group.id) { selection = nil }
                chatStore.remove(chatId: group.id)
            case .clear(let chatId, _, _):
                // Gleiche Sitzung, leer: eine neue würde die offene Ansicht (gleiche Chat-Id) nie laden, sie hinge auf „Lädt …“.
                chatStore.existingSession(for: chatId)?.cleared()
            case .memory, nil: break
            }
        } catch {
            // Wie im Web bleibt die Bestätigung offen und zeigt den Fehler als Hinweis.
            deleteError = error.localizedDescription
        }
    }

    func shutdown() {
        desktops.shutdown()
        events.stop()
        service.shutdown()
    }

    // Chat, der gerade im Fenster offen ist (nil = Seite ohne Chat).
    var openChatId: String? {
        switch selection {
        case .bot(let id): botStore.bot(id: id)?.chatId
        case .group(let id): id
        case .run(let chatId, _): chatId
        default: nil
        }
    }

    // Orbis des offenen Chats (Direktchat: der Orbi, Gruppe: alle Mitglieder, Lauf: sein Orbi).
    var openBotIds: Set<String> {
        switch selection {
        case .bot(let id): [id]
        case .group(let id): Set(botStore.groups.first { $0.id == id }?.members.map(\.id) ?? [])
        case .run(_, let botId): [botId]
        default: []
        }
    }

    // Zustand einer Figur: Rückfrage und Arbeit aus den Ereignissen oder dem lokalen Lauf, Limit aus dem Fehlertext,
    // „tippt“ solange im Direktchat Text im Eingabefeld steht.
    func state(forBot bot: Bot) -> OrbiState { state(chatId: bot.chatId, botId: bot.id) }

    // Eingabe sperren, solange im Chat ein Turn läuft: lokal gestartet oder laut Ereignissen (Automation, Übergabe).
    // Gruppenchat: auch zwischen zwei Sprechern einer Runde belegt (der Dienst antwortet auf neue Turns mit 409).
    func isLocked(chatId: String) -> Bool {
        chatStore.existingSession(for: chatId)?.isRunning == true || events.board.state(forChat: chatId) == .working
            || events.interactions.isRoundActive(chatId: chatId)
    }

    // „wartet bis 14:30 Uhr“ für den Limit-Zustand eines Chats (Rücksetzzeit des Anbieters aus /v1/usage); nil = Zeit unbekannt.
    func limitText(chatId: String) -> String? {
        guard let composer = chatStore.existingSession(for: chatId)?.composer else { return nil }
        return LimitStore.shared.waitsText(modelProvider: composer.selectedModel?.provider, modelId: composer.modelId)
    }

    // Status aus Ereignissen und Dienststand.
    func showsStatusDot(bot: Bot) -> SidebarStatus.Dot? {
        events.sidebar.dot(chatIds: [bot.chatId], state: state(forBot: bot), openChatId: openChatId)
    }

    func state(forGroup chatId: String) -> OrbiState {
        let state = events.board.state(forChat: chatId)
        if let session = chatStore.existingSession(for: chatId), session.isRunning, state.priority < OrbiState.working.priority { return .working }
        return state
    }

    func state(chatId: String, botId: String) -> OrbiState {
        var state = events.board.state(forChat: chatId)
        if events.board.state(forBot: botId).priority > state.priority { state = events.board.state(forBot: botId) }
        guard let session = chatStore.existingSession(for: chatId) else { return state }
        if session.isRunning && state.priority < OrbiState.working.priority { state = .working }
        if session.isLimited && state.priority <= OrbiState.error.priority { state = .limit }
        if state == .calm && !session.draft.isEmpty && !session.isRunning { state = .listening }
        return state
    }
}
