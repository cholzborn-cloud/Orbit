import AppKit
import Foundation
import Observation
import Security

// Zustand der Einstellungen (4d, Web: components/settings/*). Jeder Reiter lädt beim Öffnen und kennt

enum SettingsSection: String, CaseIterable, Identifiable, Sendable {
    case setup, usage, orbis, skills, connectors, approvals, marketplace, appearance

    static let allCases: [SettingsSection] = [.setup, .usage, .appearance, .orbis, .marketplace]

    var navigation: SettingsSection {
        switch self {
        case .skills: .orbis
        case .connectors: .marketplace
        case .approvals: .setup
        default: self
        }
    }

    var id: String { rawValue }
    var title: String {
        switch self {
        case .usage: "Nutzung"
        case .setup: "Allgemein"
        case .orbis: "Orbis"
        case .skills: "Skills"
        case .connectors: "Konnektoren"
        case .approvals: "Freigaben"
        case .marketplace: "Marktplatz"
        case .appearance: "Darstellung"
        }
    }
    // SF Symbols nah an den Lucide-Symbolen des Webs (Gauge, Sparkles, BookOpenText, Wrench, PlugZap, ShieldCheck, Store, Palette).
    var symbol: String {
        switch self {
        case .usage: "gauge.with.needle"
        case .setup: "gearshape"   // Figma Navi Allgemein: Zahnrad
        case .orbis: "book"
        case .skills: "wrench"
        case .connectors: "powerplug"
        case .approvals: "checkmark.shield"
        case .marketplace: "storefront"
        case .appearance: "paintpalette"
        }
    }
}

enum ConnectorStatus: Equatable {
    case testing
    case ok(count: Int, tools: String)
    case error(String)
}

@MainActor @Observable
final class SettingsStore {
    let client: ServiceClient
    private let openAuthURL: (URL) -> Bool
    private var awaitingBrowserReturn = false
    private var selectedSection: SettingsSection = .setup
    var showConnectors = false
    var section: SettingsSection {
        get { selectedSection }
        set {
            selectedSection = newValue.navigation
            if newValue == .connectors { showConnectors = true }
        }
    }
    // Wird nach jeder Änderung an den Skills gerufen (Slash-Menü neu laden).
    @ObservationIgnored var onSkillsChanged: (() -> Void)?

    private(set) var usage: Load<UsageResponse> = .idle
    private(set) var jevSettings: Load<(auto: Bool, handoff: Bool)> = .idle
    private(set) var jevLog: Load<[JevEntry]> = .idle
    var jevError: String?
    private(set) var instructions: Load<InstructionsState> = .idle
    var instructionsError: String?
    private(set) var instructionsSaving = false
    private(set) var skills: Load<[SkillItem]> = .idle
    var skillsError: String?
    private(set) var connectors: Load<[ConnectorItem]> = .idle
    private(set) var connectorStatus: [String: ConnectorStatus] = [:]
    var connectorsError: String?
    var editingConnector: String?
    // Formulare „Neuer Skill“ und „Konnektor hinzufügen“ offen (liegen hier, damit Screenshot-Szenen sie öffnen können).
    var skillFormOpen = false
    var connectorFormOpen = false
    private(set) var market: Load<[MarketEntry]> = .idle
    private(set) var installed: Set<String> = []
    private(set) var installing: String?
    var marketError: String?
    private(set) var plugins: Load<[PluginEntry]> = .idle
    private(set) var pluginsConfigured = false
    private(set) var pluginCategories: [PluginCategory] = []
    private var pluginSearch = ""
    private var pluginCategory = ""
    private(set) var pluginCursor: String?
    private(set) var pluginLoadingMore = false
    private(set) var connectingPlugin: String?
    private(set) var disconnectingPlugin: String?
    var pluginError: String?
    var pluginNotice: String?
    private(set) var rules: Load<[ApprovalRuleItem]> = .idle
    var rulesError: String?
    private(set) var theme: String = "system"
    var themeError: String?

    struct InstructionsState { var saved: String?; var defaultText: String; var limit: Int }

    // Einrichtung und Tagesbudget (Phase 5); Namen der Orbis für „Tokens heute“ liefert die App.
    let setup: SetupModel
    @ObservationIgnored var botNames: () -> [String: String] = { [:] }

    init(client: ServiceClient, setup: SetupModel? = nil, openAuthURL: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) }) {
        self.client = client
        self.openAuthURL = openAuthURL
        self.setup = setup ?? SetupModel(service: client)
    }

    static func message(_ error: Error) -> (text: String, offline: Bool) {
        if case ServiceError.offline = error { return ("Der lokale Dienst ist nicht erreichbar. Starte Orbit neu oder prüfe den Dienst.", true) }
        return (error.localizedDescription, false)
    }

    // Lädt den Reiter beim Einblenden (Web: useEffect je Sektion).
    func load(_ section: SettingsSection) async {
        switch section {
        case .usage: await loadUsage()
        case .setup: await setup.load(); await loadRules()
        case .orbis: await loadInstructions(); await loadSkills()
        case .skills: await loadSkills()
        case .connectors: await loadConnectors()
        case .approvals: await loadRules()
        case .marketplace: await loadMarket(); await loadConnectors()
        case .appearance: await loadTheme()
        }
    }

    // MARK: Nutzung

    func loadUsage(fresh: Bool = false) async {
        usage = .loading
        do { usage = .loaded(try await client.usage(fresh: fresh)) } catch {
            let m = Self.message(error); usage = .failed(m.text, offline: m.offline)
        }
    }

    // MARK: Jev

    func loadJev() async {
        jevSettings = .loading; jevLog = .loading; jevError = nil
        async let settings: Result<SettingsFull, Error> = capture { try await self.client.settingsFull() }
        async let log: Result<JevLog, Error> = capture { try await self.client.jevLog() }
        switch await settings {
        case .success(let full): jevSettings = .loaded((full.settings.jevAuto ?? true, full.settings.jevHandoff ?? false))
        case .failure(let error): let m = Self.message(error); jevSettings = .failed(m.text, offline: m.offline)
        }
        switch await log {
        case .success(let log): jevLog = .loaded(log.entries)
        case .failure(let error): let m = Self.message(error); jevLog = .failed(m.text, offline: m.offline)
        }
    }

    // Schalter sofort umlegen, bei Fehler zurück und Fehlertext zeigen (jev-section.tsx: change).
    func setJev(auto: Bool? = nil, handoff: Bool? = nil) async {
        guard let previous = jevSettings.value else { return }
        jevError = nil
        jevSettings = .loaded((auto ?? previous.auto, handoff ?? previous.handoff))
        do { try await client.setJev(auto: auto, handoff: handoff) } catch {
            jevSettings = .loaded(previous); jevError = Self.message(error).text
        }
    }

    // MARK: Orbis-Anleitung

    func loadInstructions() async {
        instructions = .loading; instructionsError = nil
        async let settings: Result<SettingsFull, Error> = capture { try await self.client.settingsFull() }
        async let base: Result<InstructionsDefault, Error> = capture { try await self.client.instructionsDefault() }
        do {
            let full = try await settings.get(), standard = try await base.get()
            instructions = .loaded(InstructionsState(saved: full.settings.baseInstructions, defaultText: standard.text, limit: standard.limit))
        } catch { let m = Self.message(error); instructions = .failed(m.text, offline: m.offline) }
    }

    // nil = auf Standard zurücksetzen. Ein dem Standard gleicher Text gilt als Standard (normalizeBaseInstructions).
    func saveInstructions(_ text: String?) async {
        guard var state = instructions.value else { return }
        instructionsSaving = true; instructionsError = nil
        defer { instructionsSaving = false }
        do {
            try await client.setInstructions(text ?? "")
            state.saved = (text == nil || text == state.defaultText) ? nil : text
            instructions = .loaded(state)
        } catch { instructionsError = Self.message(error).text }
    }

    // MARK: Skills

    func loadSkills() async {
        skills = .loading; skillsError = nil
        do { skills = .loaded(try await client.skills().skills) } catch {
            let m = Self.message(error); skills = .failed(m.text, offline: m.offline)
        }
    }

    // Gibt Fehlertext zurück (nil = gespeichert), damit das Formular ihn selbst zeigt.
    func saveSkill(id: String?, _ form: SkillForm) async -> String? {
        if let error = SkillRules.error(for: form) { return error }
        do {
            if let id { try await client.updateSkill(id: id, form) } else { try await client.createSkill(form) }
            onSkillsChanged?()
            await loadSkills()
            return nil
        } catch { return Self.message(error).text }
    }

    func deleteSkill(_ skill: SkillItem) async {
        skillsError = nil
        do { try await client.deleteSkill(id: skill.id); onSkillsChanged?(); await loadSkills() } catch { skillsError = Self.message(error).text }
    }

    // MARK: Konnektoren

    func loadConnectors() async {
        if connectors.value == nil { connectors = .loading }
        do { connectors = .loaded(try await client.connectors().connectors) } catch {
            let m = Self.message(error); connectors = .failed(m.text, offline: m.offline)
        }
    }

    @discardableResult
    func test(_ id: String) async -> ConnectorStatus {
        connectorStatus[id] = .testing
        let status: ConnectorStatus
        do {
            let result = try await client.testConnector(id: id)
            status = .ok(count: result.count, tools: result.summary)
        } catch { status = .error(Self.message(error).text) }
        connectorStatus[id] = status
        return status
    }

    // Hinzufügen, danach testen; verlangt der Server eine Anmeldung, öffnet sich der Browser (Web: openLogin).
    func addConnector(_ form: ConnectorForm) async -> String? {
        connectorsError = nil
        do {
            let id = try await client.addConnector(form)
            await loadConnectors()
            let status = await test(id)
            if case .error(let text) = status, ConnectorRules.needsLogin(text), form.token == nil {
                if let error = await signIn(id) { connectorsError = error }
            }
            return nil
        } catch { return Self.message(error).text }
    }

    // Öffnet die Anbieter-Anmeldung im Systembrowser; der Rücksprung landet auf /oauth/callback des Dienstes.
    func signIn(_ id: String) async -> String? {
        do {
            let oauth = try await client.startConnectorOAuth(id: id)
            if oauth.authorized { await loadConnectors(); await test(id); return nil }
            guard let text = oauth.url, let url = URL(string: text), url.scheme == "https" || url.scheme == "http" else {
                return "Der Server liefert keine Anmelde-Adresse. Gib stattdessen einen Schlüssel ein."
            }
            guard openAuthURL(url) else { return "Die Anmeldung konnte nicht geöffnet werden." }
            awaitingBrowserReturn = true
            return nil
        } catch { return Self.message(error).text }
    }

    func signOut(_ id: String) async -> String? {
        do { try await client.disconnectConnectorOAuth(id: id); await loadConnectors(); return nil } catch { return Self.message(error).text }
    }

    func setEnabled(_ id: String, _ enabled: Bool) async {
        connectorsError = nil
        do { try await client.setConnector(id: id, enabled: enabled) } catch { connectorsError = Self.message(error).text }
        await loadConnectors()
    }

    func setAllEnabled(_ enabled: Bool) async {
        connectorsError = nil
        do { try await client.setAllConnectors(enabled: enabled) } catch { connectorsError = Self.message(error).text }
        await loadConnectors()
    }

    func saveAuth(_ id: String, token: String, header: String?) async -> String? {
        do { try await client.setConnectorAuth(id: id, token: token, header: header); await loadConnectors(); await test(id); return nil } catch { return Self.message(error).text }
    }

    func deleteConnector(_ id: String) async -> String? {
        do { try await client.deleteConnector(id: id); connectorStatus[id] = nil; await loadConnectors(); return nil } catch { return Self.message(error).text }
    }

    // Nach dem Rücksprung aus dem Browser die Listen aktualisieren, ohne Verbindungen ungefragt zu prüfen.
    func appBecameActive() async {
        guard awaitingBrowserReturn else { return }
        awaitingBrowserReturn = false
        guard section == .marketplace else { return }
        await loadPlugins()
        await loadConnectors()
    }

    // Apple-Zugang bleibt im Schlüsselbund und wird nie an das Modell übergeben.
    private static var iCloudKeychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "de.consti.orbit.icloud-calendar", kSecAttrAccount as String: "local"]
    }

    var appleCalendarConfigured: Bool {
        SecItemCopyMatching(Self.iCloudKeychainQuery as CFDictionary, nil) == errSecSuccess
    }

    func connectAppleCalendar(appleId: String, password: String) async -> String? {
        do {
            try await client.verifyICloud(appleId: appleId, appPassword: password)
            let data = try JSONEncoder().encode(["appleId": appleId, "appPassword": password])
            let query = Self.iCloudKeychainQuery
            let changed = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if changed == errSecItemNotFound {
                var newItem = query
                newItem[kSecValueData as String] = data
                guard SecItemAdd(newItem as CFDictionary, nil) == errSecSuccess else { return "Der Zugang konnte nicht im Schlüsselbund gespeichert werden." }
            } else if changed != errSecSuccess { return "Der Zugang konnte nicht im Schlüsselbund gespeichert werden." }
            return nil
        } catch { return Self.message(error).text }
    }

    func disconnectAppleCalendar() -> String? {
        let status = SecItemDelete(Self.iCloudKeychainQuery as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound ? nil : "Der Zugang konnte nicht entfernt werden."
    }

    func configureComposio(key: String) async -> String? {
        let defaults = UserDefaults.standard
        let user = defaults.string(forKey: "composio.localUser") ?? UUID().uuidString
        do {
            try await client.verifyComposio(key: key, user: user)
            let data = try JSONEncoder().encode(["key": key, "user": user])
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "de.consti.orbit.composio", kSecAttrAccount as String: "local"]
            let changed = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if changed == errSecItemNotFound {
                var item = query; item[kSecValueData as String] = data
                guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { return "Der Zugang konnte nicht im Schlüsselbund gespeichert werden." }
            } else if changed != errSecSuccess { return "Der Zugang konnte nicht im Schlüsselbund gespeichert werden." }
            defaults.set(user, forKey: "composio.localUser")
            try await client.reloadPluginCredentials()
            await loadPlugins()
            return nil
        } catch { return Self.message(error).text }
    }

    // MARK: Marktplatz

    func loadPlugins(more: Bool = false, search: String? = nil, category: String? = nil) async {
        if let search { pluginSearch = search }; if let category { pluginCategory = category }
        let requestedSearch = pluginSearch, requestedCategory = pluginCategory
        if more { guard !pluginLoadingMore, pluginCursor != nil else { return }; pluginLoadingMore = true }
        else if plugins.value == nil || search != nil || category != nil { plugins = .loading }
        pluginError = nil
        defer { pluginLoadingMore = false }
        do {
            let result = try await client.plugins(cursor: more ? pluginCursor : nil, search: requestedSearch, category: requestedCategory)
            guard !Task.isCancelled, requestedSearch == pluginSearch, requestedCategory == pluginCategory else { return }
            let knownCategories = pluginCategories + result.entries.flatMap(\.categories)
            pluginCategories = Array(Dictionary(knownCategories.map { ($0.id, $0) }, uniquingKeysWith: { old, _ in old }).values).sorted { $0.name < $1.name }
            let previous = more ? plugins.value ?? [] : []
            let ids = Set(previous.map(\.id))
            plugins = .loaded(previous + result.entries.filter { !ids.contains($0.id) })
            pluginsConfigured = result.configured
            pluginCursor = result.nextCursor
        } catch {
            guard !Task.isCancelled else { return }
            let message = Self.message(error)
            if plugins.value == nil { plugins = .failed(message.text, offline: message.offline) }
            else { pluginError = message.text }
        }
    }

    func pluginAccounts(_ plugin: PluginEntry) async throws -> [PluginConnectionAccount] {
        try await client.pluginAccounts(slug: plugin.slug).accounts
    }

    func disconnectPlugin(_ plugin: PluginEntry, accountIds: [String]) async -> PluginDisconnectResponse? {
        guard disconnectingPlugin == nil, connectingPlugin == nil else { return nil }
        disconnectingPlugin = plugin.id; pluginError = nil; pluginNotice = nil
        defer { disconnectingPlugin = nil }
        do {
            let result = try await client.disconnectPlugin(slug: plugin.slug, accountIds: accountIds)
            await loadPlugins()
            pluginNotice = "\(result.deletedIds.count) Verbindung(en) bei Composio gelöscht. \(result.notice)"
            if !result.failedIds.isEmpty {
                pluginError = "\(result.failedIds.count) Verbindung(en) konnten nicht getrennt werden. Öffne die Kontenauswahl erneut und versuche es noch einmal."
            }
            return result
        } catch {
            pluginError = Self.message(error).text
            return nil
        }
    }

    func pluginSetup(_ plugin: PluginEntry) async throws -> PluginSetupResponse {
        try await client.pluginSetup(slug: plugin.slug)
    }

    func setupPlugin(_ plugin: PluginEntry, scheme: PluginSetupScheme, fields: [String: String]) async -> String? {
        let parsed = scheme.encodeFields(fields)
        if let error = parsed.error { return error }
        guard let values = parsed.values else { return "Die Eingaben sind ungültig." }
        do {
            let result = try await client.setupPlugin(slug: plugin.slug, scheme: scheme.scheme, fields: values)
            guard let address = result.url, let url = URL(string: address), url.scheme == "https",
                  ["connect.composio.dev", "app.composio.dev"].contains(url.host ?? "") else { return "Die sichere Anmeldeseite ist nicht verfügbar." }
            guard openAuthURL(url) else { return "Die Anmeldung konnte nicht geöffnet werden." }
            awaitingBrowserReturn = true
            pluginNotice = "Schließe die Anmeldung im Browser ab. Danach wird der Status neu geladen."
            return nil
        } catch { return Self.message(error).text }
    }

    func connect(_ plugin: PluginEntry) async {
        guard connectingPlugin == nil, disconnectingPlugin == nil else { return }
        connectingPlugin = plugin.id; pluginError = nil; pluginNotice = nil
        defer { connectingPlugin = nil }
        do {
            let result = try await client.connectPlugin(slug: plugin.slug)
            if let address = result.url {
                guard let url = URL(string: address), url.scheme == "https", url.host != nil else { throw ServiceError.invalidResponse }
                guard openAuthURL(url) else { pluginError = "Die Anmeldung konnte nicht geöffnet werden."; return }
                awaitingBrowserReturn = true
                pluginNotice = "Schließe die Anmeldung im Browser ab. Danach wird der Status neu geladen."
            } else if result.connectionStatus == "connected" {
                pluginNotice = result.toolsEnabled ? "Verbunden." : "Konto verbunden. Die verfügbaren Aktionen werden beim Chat geprüft."
            } else { pluginNotice = "Die Verbindung ist noch nicht abgeschlossen." }
            await loadPlugins()
        } catch { pluginError = Self.message(error).text }
    }


    func loadMarket() async {
        market = .loading; marketError = nil
        do {
            let entries = try await client.marketplace().entries
            async let skills: Result<SkillsResponse, Error> = capture { try await self.client.skills() }
            async let connectors: Result<ConnectorsResponse, Error> = capture { try await self.client.connectors() }
            var keys: Set<String> = []
            switch await skills { case .success(let r): keys.formUnion(r.skills.map { "skill:\($0.name)" }); case .failure(let e): marketError = Self.message(e).text }
            switch await connectors { case .success(let r): keys.formUnion(r.connectors.map { "mcp:\($0.name)" }); case .failure(let e): marketError = Self.message(e).text }
            installed = keys
            market = .loaded(entries)
        } catch { let m = Self.message(error); market = .failed(m.text, offline: m.offline) }
    }

    func install(_ entry: MarketEntry) async {
        installing = entry.id; marketError = nil
        defer { installing = nil }
        do {
            if entry.isConnector {
                let id = try await client.addConnector(ConnectorForm(name: entry.name, url: entry.url ?? "", token: nil))
                let status = await test(id)
                if case .error(let text) = status {
                    if ConnectorRules.needsLogin(text) {
                        if let error = await signIn(id) { marketError = error }
                    } else { marketError = text }
                }
            } else {
                try await client.createSkill(SkillForm(name: entry.skillName ?? "", description: entry.skillDescription ?? "", body: entry.skillBody ?? ""))
            }
            installed.insert(entry.installKey)
            if !entry.isConnector { onSkillsChanged?() }
        } catch { marketError = Self.message(error).text }
    }

    // MARK: Freigaben

    func loadRules() async {
        rules = .loading; rulesError = nil
        do { rules = .loaded(try await client.rules().rules) } catch { let m = Self.message(error); rules = .failed(m.text, offline: m.offline) }
    }

    func deleteRule(_ rule: ApprovalRuleItem) async {
        rulesError = nil
        do { try await client.deleteRule(id: rule.id); await loadRules() } catch { rulesError = Self.message(error).text }
    }

    // MARK: Darstellung

    func loadTheme() async {
        do {
            let settings = try await client.settingsFull().settings
            let value = settings.theme ?? "system"
            theme = value; Self.apply(theme: value); themeError = nil
        } catch { themeError = Self.message(error).text }
    }

    // Sofort anwenden, dann speichern (appearance-section.tsx: choose).
    func setTheme(_ value: String) async {
        guard ["light", "dark", "system"].contains(value) else { return }
        theme = value; themeError = nil
        Self.apply(theme: value)
        do { try await client.setTheme(value) } catch { themeError = Self.message(error).text }
    }

    static func apply(theme: String) {
        NSApp?.appearance = switch theme {
        case "light": NSAppearance(named: .aqua)
        case "dark": NSAppearance(named: .darkAqua)
        default: nil
        }
    }

    // Nur Screenshot-Szenen: zeigt einen Sonderzustand eines Reiters (fehler, offline, leer, laedt, lang, ohne-daten).
    // Nur für Bildschirmfotos: Konnektoren und Skills vorgeben.
    func simulate(connectors list: [ConnectorItem], skills items: [SkillItem]) { connectors = .loaded(list); skills = .loaded(items) }
    func simulate(usage value: UsageResponse) { usage = .loaded(value) }

    func simulate(_ section: SettingsSection, variant: String) {
        let failed = variant == "offline" ? ("Der lokale Dienst ist nicht erreichbar. Starte Orbit neu oder prüfe den Dienst.", true) : ("Die Antwort des Dienstes ist ungültig.", false)
        func make<T>(_ empty: T, _ long: T) -> Load<T> {
            switch variant {
            case "fehler", "offline": .failed(failed.0, offline: failed.1)
            case "laedt": .loading
            case "lang": .loaded(long)
            default: .loaded(empty)
            }
        }
        let many = 1...60
        switch section {
        case .usage:
            let account = UsageAccount(id: "a", label: "Konto", status: "ok", note: nil, windows: [])
            switch variant {
            case "ohne-daten": usage = .loaded(UsageResponse(providers: [
                UsageProvider(provider: "claude", status: "error", note: "Nutzung konnte nicht geladen werden.", accounts: []),
                UsageProvider(provider: "codex", status: "ok", note: nil, accounts: [account]),
                UsageProvider(provider: "antigravity", status: "offline", note: nil, accounts: [])], fetchedAt: Date().timeIntervalSince1970 * 1000))
            default: usage = make(UsageResponse(providers: [], fetchedAt: Date().timeIntervalSince1970 * 1000), UsageResponse(providers: [], fetchedAt: 0))
            }
        case .setup: break   // Einrichtung: keine Bildschirmfoto-Szenen
        case .orbis: instructions = make(InstructionsState(saved: nil, defaultText: "", limit: 8000), InstructionsState(saved: String(repeating: "Sehr lange Anleitung. ", count: 400), defaultText: "", limit: 8000))
        case .skills: skills = make([], many.map { SkillItem(id: "s\($0)", name: "skill-\($0)", description: "Beschreibung des Skills Nummer \($0), die auch etwas länger sein darf.", body: "x") })
        case .connectors: connectors = make([], many.map { ConnectorItem(id: "c\($0)", name: "Konnektor \($0)", url: "https://server\($0).example/mcp", enabled: $0 % 2 == 0, authHeader: nil, hasAuth: $0 % 3 == 0, oauth: false) })
        case .approvals: rules = make([], many.map { ApprovalRuleItem(id: "r\($0)", tool: "connector:beispiel:werkzeug_mit_langem_namen_\($0)", botId: nil, botName: $0 % 2 == 0 ? "Karti" : nil, mode: "allow") })
        case .marketplace: market = make([], many.map { MarketEntry(id: "m\($0)", name: "Eintrag \($0)", description: "Beschreibung", type: "skill", source: "Orbit", risk: "read", permissions: "Liest den Text.", verified: true, url: nil, skillName: "eintrag-\($0)", skillDescription: "d", skillBody: "b") })
        case .appearance: themeError = variant == "fehler" || variant == "offline" ? failed.0 : nil
        }
    }

    private func capture<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await work()) } catch { return .failure(error) }
    }
}
