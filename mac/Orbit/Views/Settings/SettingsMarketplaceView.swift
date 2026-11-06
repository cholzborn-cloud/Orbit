import SwiftUI

// Reiter „Marktplatz“ (marketplace-section.tsx): Katalog mit Rechten und Quelle, Installieren legt Skill oder Konnektor an.
struct SettingsMarketplaceView: View {
    let store: SettingsStore
    var loadCatalogDuringStaticRendering = false
    @Environment(\.settingsConfirm) private var confirm
    @Environment(\.staticRendering) private var staticRendering

    @State private var search = ""
    @State private var category = ""
    @State private var showComposioSetup = false
    @State private var composioKey = ""
    @State private var composioBusy = false
    @State private var composioMessage: String?
    @State private var showAppleSetup = false
    @State private var appleId = ""
    @State private var applePassword = ""
    @State private var appleBusy = false
    @State private var appleMessage: String?
    @State private var appleConnected = false

    private var showComposio: Bool { category.isEmpty && (search.isEmpty || "Composio".localizedStandardContains(search)) }
    private var showApple: Bool { (category.isEmpty || (category == "connected" && appleConnected)) && (search.isEmpty || "Apple Kalender".localizedStandardContains(search)) }

    var body: some View {
        // Figma Marktplatz (192:18895): Abstand 20; Kopf Abstand 7, Untertitel 13 Regular.
        VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt7) {
                Text("Marktplatz").font(Theme.Fonts.settingsTitle).accessibilityAddTraits(.isHeader)
                Text("Dienste für deine Orbis verbinden.").font(Theme.Fonts.subhead).foregroundStyle(Theme.Palette.mutedForeground)
            }
            // Suchfeld (192:18899): 44 hoch, innen 0/14, Abstand 10, Lupe 16, Text 13.
            HStack(spacing: Theme.Metrics.pt10) {
                Image(systemName: "magnifyingglass").font(.system(size: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground)
                TextField("Dienste suchen", text: $search, prompt: Text("Dienste suchen").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).font(Theme.Fonts.subhead).accessibilityLabel("Dienste suchen")
                if !search.isEmpty {
                    Button { search = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).accessibilityLabel("Suche leeren")
                }
            }
            .padding(.horizontal, Theme.Metrics.pt14).frame(height: Theme.Metrics.pt44)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.PluginStore.borderWidth) }
            ScrollView(.horizontal) {
                HStack(spacing: Theme.Metrics.pt8) {
                    categoryButton("Alle", id: "")
                    categoryButton("Produktivität", id: categoryID("productivity", "Produktivität"))
                    categoryButton("Kommunikation", id: categoryID("communication", "Kommunikation"))
                    categoryButton("Entwicklung", id: categoryID("development", "Entwicklung"))
                    categoryButton("Verbunden", id: "connected")
                }
            }.scrollIndicators(.never)
            // Abschnittskopf (192:18917): Titel 17 Semibold, Abstand 5.
            VStack(alignment: .leading, spacing: Theme.Metrics.pt5) {
                Text("Dienste entdecken").font(Theme.Fonts.geist(Theme.Fonts.size17, .semibold)).accessibilityAddTraits(.isHeader)
                SettingsHint(text: "Was Orbit nutzen darf.", small: true)
            }
            if let error = store.pluginError { SettingsAlert(text: error) }
            if let notice = store.pluginNotice { SettingsHint(text: notice) }
            SettingsProvidersView(client: store.client) {
                if showComposio { composioCard }
                if showApple { appleCard }
            }
            pluginCatalog
            // Fußzeile (192:19036): links Hinweis 12 Regular, rechts „Konnektoren verwalten →“ 12 Medium, innen vertikal 8.
            HStack(spacing: Theme.Metrics.pt12) {
                Text("Du entscheidest, was verbunden ist.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                Spacer(minLength: Theme.Metrics.pt8)
                Button { store.showConnectors.toggle() } label: {
                    Text("Konnektoren verwalten →").font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.foreground)
                }
                .buttonStyle(.plain).accessibilityAddTraits(store.showConnectors ? .isSelected : [])
            }
            .padding(.vertical, Theme.Metrics.pt8)
            if store.showConnectors { SettingsConnectorsView(store: store) }
            legacyCatalog
        }
        .task { if !staticRendering { appleConnected = store.appleCalendarConfigured } }
        .task(id: search + "|" + category) {
            guard !staticRendering || loadCatalogDuringStaticRendering else { return }
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            await store.loadPlugins(search: search, category: category)
        }
    }

    private var appleCard: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            HStack(spacing: Theme.Metrics.pt12) {
                MarketTileLogo { Image("logo-apple").resizable().interpolation(.high).scaledToFit() }
                MarketTileText(title: "Apple Kalender", text: appleConnected ? "Zugang gespeichert · Verbindung im Chat prüfen" : "iCloud mit app-spezifischem Passwort verbinden")
                Spacer(minLength: Theme.Metrics.pt8)
                let toggleSetup = { showAppleSetup.toggle(); appleMessage = nil; if !showAppleSetup { applePassword = "" } }
                if appleConnected { MarketConnectedLabel(action: toggleSetup) }
                else { Button("Verbinden", action: toggleSetup).buttonStyle(MarketTileButtonStyle()) }
            }
            if showAppleSetup {
                SettingsHint(text: "App-spezifisches Passwort vom Apple-Account. Orbit speichert es im Schlüsselbund.", small: true)
                Link("App-spezifisches Passwort erstellen", destination: URL(string: "https://account.apple.com/")!)
                TextField("Apple-ID", text: $appleId, prompt: Text("Apple-ID").foregroundStyle(Theme.Palette.mutedForeground)).webInput().accessibilityLabel("Apple-ID")
                SecureField("App-spezifisches Passwort", text: $applePassword).webInput().accessibilityLabel("App-spezifisches Passwort")
                if let appleMessage { SettingsHint(text: appleMessage, small: true) }
                HStack {
                    Button(appleBusy ? "Wird geprüft …" : "Verbinden") {
                        appleBusy = true
                        Task {
                            let error = await store.connectAppleCalendar(appleId: appleId, password: applePassword)
                            applePassword = ""
                            appleConnected = store.appleCalendarConfigured
                            appleMessage = error ?? "Zugang gespeichert."
                            appleBusy = false
                        }
                    }.buttonStyle(.card(.secondary, small: true)).disabled(appleBusy || appleId.isEmpty || applePassword.isEmpty)
                    if appleConnected {
                        Button("Trennen") {
                            appleMessage = store.disconnectAppleCalendar() ?? "Zugang entfernt."
                            applePassword = ""; appleConnected = store.appleCalendarConfigured
                        }.buttonStyle(.card(.outline, small: true)).disabled(appleBusy)
                    }
                }
            }
        }
        .marketTile()
    }

    private var composioCard: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            HStack(spacing: Theme.Metrics.pt12) {
                MarketTileLogo { Image("logo-composio").resizable().interpolation(.high).scaledToFit() }
                MarketTileText(title: "Composio", text: "Weitere Dienste für Orbit entdecken")
                Spacer(minLength: Theme.Metrics.pt8)
                Button("Einrichten") { showComposioSetup.toggle(); if !showComposioSetup { composioKey = "" } }.buttonStyle(MarketTileButtonStyle())
            }
            if showComposioSetup {
                SettingsHint(text: "Projekt-Schlüssel aus Composio einfügen. Orbit speichert ihn im Schlüsselbund. Danach verbindest du die Dienste einzeln.", small: true)
                Link("Composio öffnen", destination: URL(string: "https://platform.composio.dev/")!)
                SecureField("Composio-Projekt-Schlüssel", text: $composioKey).webInput().accessibilityLabel("Composio-Projekt-Schlüssel")
                if let composioMessage { SettingsHint(text: composioMessage, small: true) }
                Button(composioBusy ? "Wird geprüft …" : "Speichern") {
                    composioBusy = true
                    Task {
                        let error = await store.configureComposio(key: composioKey)
                        composioKey = ""
                        composioMessage = error ?? "Composio ist eingerichtet."
                        composioBusy = false
                    }
                }.buttonStyle(.card(.secondary, small: true)).disabled(composioBusy || composioKey.isEmpty)
            }
        }
        .marketTile()
    }

    private func categoryButton(_ name: String, id: String) -> some View {
        Button(name) { category = id }.buttonStyle(MarketChipStyle(selected: category == id))
        .accessibilityAddTraits(category == id ? .isSelected : [])
    }

    private func categoryID(_ fallback: String, _ german: String) -> String {
        store.pluginCategories.first { $0.id.lowercased() == fallback || $0.name.localizedCaseInsensitiveCompare(german) == .orderedSame || $0.name.localizedCaseInsensitiveCompare(fallback) == .orderedSame }?.id ?? fallback
    }

    @ViewBuilder private var pluginCatalog: some View {
        switch store.plugins {
        case .idle, .loading:
            SettingsSkeleton(height: Theme.PluginStore.cardHeight, radius: Theme.Radius.lg)
                .accessibilityLabel("Dienste werden geladen")
        case .failed(let message, let offline):
            SettingsFailure(message: message, offline: offline) { Task { await store.loadPlugins() } }
        case .loaded(let entries):
            if !store.pluginsConfigured {
                SettingsHint(text: "Composio ist noch nicht eingerichtet. Schlüssel hinterlegen, um weitere Dienste zu sehen.")
            }
            let visible = entries.filter { !OrbitBuiltIns.isHidden(source: $0.source) && $0.matches(search: "", category: category == "connected" ? "connected" : "") }
            if visible.isEmpty && !showComposio && !showApple { SettingsHint(text: "Keine passenden Dienste gefunden.") }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: Theme.Metrics.pt12), GridItem(.flexible())], spacing: Theme.Metrics.pt12) {
                ForEach(visible) { plugin in PluginStoreCard(plugin: plugin, store: store, busy: store.connectingPlugin != nil || store.disconnectingPlugin != nil, connecting: store.connectingPlugin == plugin.id) {
                    Task { await store.connect(plugin) }
                } }
            }
            if store.pluginCursor != nil {
                Button(store.pluginLoadingMore ? "Wird geladen …" : "Weitere Dienste laden") { Task { await store.loadPlugins(more: true) } }
                    .buttonStyle(.card(.outline, small: true)).disabled(store.pluginLoadingMore)
            }
        }
    }

    @ViewBuilder private var legacyCatalog: some View {
        switch store.market {
        case .idle, .loading: EmptyView()
        case .failed(let message, let offline):
            SettingsFailure(message: message, offline: offline) { Task { await store.loadMarket() } }
        case .loaded(let entries):
            let visible = entries.filter { !OrbitBuiltIns.isHidden(source: $0.source) && (search.isEmpty || "\($0.name) \($0.description)".localizedStandardContains(search)) }
            if !visible.isEmpty && category.isEmpty {
                Text("Weitere Fähigkeiten und Konnektoren").font(Theme.Fonts.title).accessibilityAddTraits(.isHeader)
                if let error = store.marketError { SettingsAlert(text: error) }
                LazyVStack(spacing: Theme.Spacing.md) { ForEach(visible) { card($0) } }
            }
        }
    }

    private func card(_ entry: MarketEntry) -> some View {
        let done = store.installed.contains(entry.installKey)
        let pending = store.installing == entry.id
        return HStack(spacing: Theme.Metrics.pt12) {
            MarketTileLogo { PluginLogo(slug: entry.logoSlug, name: entry.name, url: entry.logoURL) }
            MarketTileText(title: entry.name, text: entry.description, status: entry.isConnector ? "MCP-Konnektor" : "Skill")
            Spacer(minLength: Theme.Metrics.pt8)
            Button(done ? (entry.isConnector ? "Hinzugefügt" : "Installiert") : pending ? "Wird hinzugefügt …" : (entry.isConnector ? "Hinzufügen" : "Installieren")) {
                if entry.verified { Task { await store.install(entry) } } else {
                    confirm?(SettingsConfirm(title: "Nicht getestet", message: "Dieser Eintrag wurde noch nicht getestet. Trotzdem installieren?", action: "Installieren") { await store.install(entry) })
                }
            }
            .buttonStyle(MarketTileButtonStyle())
            .disabled(done || pending)
        }
        .marketTile()
        .help(entry.helpText)
    }
}

enum OrbitBuiltIns {
    static let skillNames: Set<String> = [
        "kurze-zusammenfassung", "mail-entwurf", "todo-aus-text", "recherche-plan", "lernkarten",
    ]

    static func isHidden(source: String) -> Bool {
        switch source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "orbit", "builtin", "built-in", "eingebaut": true
        default: false
        }
    }

    static func isHiddenSkill(name: String) -> Bool {
        skillNames.contains(name.lowercased())
    }
}

private extension MarketEntry {
    var logoSlug: String {
        if let url, let host = URL(string: url)?.host {
            let skip: Set<String> = ["www", "mcp", "api", "connect", "app"]
            let parts = host.lowercased().split(separator: ".")
            if let part = parts.reversed().dropFirst().first(where: { !skip.contains(String($0)) }) {
                return String(part)
            }
            return host
        }
        return name
    }

    var logoURL: String? { url }

    var helpText: String {
        let access = risk == "read" ? "Nur lesend" : "Schreibzugriff"
        let trust = verified ? "geprüft" : "noch nicht getestet"
        return "\(access). \(permissions) Quelle: \(source) · \(trust)"
    }
}

private struct PluginStoreCard: View {
    let plugin: PluginEntry
    let store: SettingsStore
    let busy: Bool
    let connecting: Bool
    let connect: () -> Void
    @State private var showSetup = false
    @State private var setup: PluginSetupResponse?
    @State private var scheme = ""
    @State private var fields: [String: String] = [:]
    @State private var setupError: String?
    @State private var setupBusy = false
    @State private var showAccounts = false
    @State private var accounts: [PluginConnectionAccount] = []
    @State private var selectedAccounts: Set<String> = []
    @State private var accountsBusy = false
    @State private var accountsError: String?
    @State private var confirmDisconnect = false


    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            HStack(spacing: Theme.Metrics.pt12) {
                MarketTileLogo { PluginLogo(slug: plugin.slug, name: plugin.name, url: plugin.logoUrl) }
                MarketTileText(title: plugin.name, text: plugin.description, status: plugin.statusText)
                Spacer(minLength: Theme.Metrics.pt8)
                let action = {
                    if plugin.authMode == "setup_required" || plugin.connectionStatus == "unavailable" {
                        showSetup.toggle()
                        if !showSetup { fields.removeAll(); setupError = nil }
                        if showSetup && setup == nil { Task { await loadSetup() } }
                    } else { connect() }
                }
                if plugin.connectionStatus == "connected" { MarketConnectedLabel(action: nil) }
                else {
                    Button(buttonTitle, action: action).buttonStyle(MarketTileButtonStyle())
                        .disabled(busy).accessibilityLabel("\(plugin.name): \(buttonTitle)")
                }
            }
            if showAccounts {
                SettingsHint(text: "Gewählte Verbindungen werden bei Composio gelöscht. Berechtigungen beim Anbieter ggf. extra widerrufen.", small: true)
                if let accountsError { SettingsAlert(text: accountsError) }
                if accountsBusy { SettingsHint(text: "Konten werden geladen …", small: true) }
                else if accounts.isEmpty && accountsError == nil { SettingsHint(text: "Keine Verbindungen für diesen Dienst gefunden.", small: true) }
                ForEach(accounts) { account in
                    Toggle(isOn: Binding(get: { selectedAccounts.contains(account.id) }, set: { selected in
                        if selected { selectedAccounts.insert(account.id) } else { selectedAccounts.remove(account.id) }
                    })) {
                        Text("Konto \(account.id) · \(account.statusText)").font(Theme.Fonts.small)
                    }.disabled(busy || accountsBusy)
                }
                if !accounts.isEmpty {
                    Button(store.disconnectingPlugin == plugin.id ? "Wird getrennt …" : "Ausgewählte Verbindungen trennen (\(selectedAccounts.count))", role: .destructive) {
                        confirmDisconnect = true
                    }
                    .buttonStyle(.card(.outline, small: true))
                    .disabled(selectedAccounts.isEmpty || busy || accountsBusy)
                    .confirmationDialog("\(selectedAccounts.count) Verbindung(en) mit \(plugin.name) trennen?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
                        Button("Bei Composio löschen", role: .destructive) {
                            let ids = selectedAccounts.sorted()
                            Task {
                                if await store.disconnectPlugin(plugin, accountIds: ids) != nil { await loadAccounts() }
                            }
                        }
                        Button("Abbrechen", role: .cancel) {}
                    } message: {
                        Text("Konten: \(selectedAccounts.sorted().joined(separator: ", ")). Verbindungen bei Composio löschen. Berechtigungen beim Anbieter ggf. extra widerrufen.")
                    }
                }
            }
            if showSetup {
                SettingsHint(text: "Dieser Dienst braucht zusätzliche Angaben, die an Composio gehen.", small: true)
                if let setupError { SettingsAlert(text: setupError) }
                if let setup {
                    if !setup.schemes.contains(where: { $0.supported }) { SettingsHint(text: "Einrichtung in Orbit noch nicht verfügbar. Bitte die Anleitung bei Composio nutzen.", small: true) }
                    if setup.schemes.count > 1 {
                        Picker("Anmeldung", selection: $scheme) {
                            ForEach(setup.schemes.filter(\.supported)) { item in Text(item.scheme).tag(item.scheme) }
                        }.onChange(of: scheme) { _, _ in fields.removeAll() }
                    }
                    if let selected = setup.schemes.first(where: { $0.scheme == scheme }) {
                        if selected.scheme == "OAUTH2", let redirect = setup.oauthRedirectUrl {
                            SettingsHint(text: "Rücksprung-Adresse (mit der Anbieteranleitung prüfen):", small: true)
                            Text(redirect).font(Theme.Fonts.small).textSelection(.enabled)
                        }
                        ForEach(selected.configFields) { field in
                            if field.type == "boolean" {
                                Picker(field.label, selection: Binding(get: { fields[field.name] ?? "" }, set: { fields[field.name] = $0 })) {
                                    Text("Bitte wählen").tag("")
                                    Text("Ja").tag("true")
                                    Text("Nein").tag("false")
                                }
                            } else if field.secret {
                                SecureField(field.label, text: Binding(get: { fields[field.name] ?? "" }, set: { fields[field.name] = $0 })).webInput()
                            } else {
                                TextField(field.label, text: Binding(get: { fields[field.name] ?? "" }, set: { fields[field.name] = $0 })).webInput()
                            }
                        }
                        if !selected.connectionFields.isEmpty { SettingsHint(text: "Weitere Zugangsdaten folgen auf der Composio-Seite.", small: true) }
                        Button(setupBusy ? "Öffnet …" : "Weiter zur Anmeldung") {
                            setupBusy = true
                            Task {
                                setupError = await store.setupPlugin(plugin, scheme: selected, fields: fields)
                                fields.removeAll()
                                setupBusy = false
                            }
                        }.buttonStyle(.card(.secondary, small: true))
                            .disabled(setupBusy || !selected.supported || selected.configFields.contains(where: { $0.required && (fields[$0.name] ?? "").isEmpty }))
                    }
                    if let guide = setup.guideUrl, let url = URL(string: guide), url.scheme == "https", url.host?.hasSuffix(".composio.dev") == true || url.host == "composio.dev" {
                        Link("Anleitung öffnen", destination: url)
                    }
                } else if setupBusy { SettingsHint(text: "Einrichtung wird geladen …", small: true) }
                Link("Composio öffnen", destination: URL(string: "https://dashboard.composio.dev/")!)
            }
        }
        .marketTile()
        // „Konten verwalten“ / „Trennen …“ (nur im Code, nicht in Figma): hinter Rechtsklick, damit die Kachel 112 hoch bleibt (M7).
        .webContextMenu(screenName: "kontext-marktplatz") {
            let linked = plugin.connectionStatus == "connected" || plugin.connectionStatus == "pending"
            return [WebMenuItem(title: linked ? "Trennen …" : "Konten verwalten", icon: linked ? "xmark.circle" : "person.2", disabled: busy || accountsBusy) {
                showAccounts.toggle()
                if showAccounts { Task { await loadAccounts() } }
            }]
        }
    }

    private func loadAccounts() async {
        accountsBusy = true; accountsError = nil; selectedAccounts.removeAll(); accounts = []
        defer { accountsBusy = false }
        do { accounts = try await store.pluginAccounts(plugin) }
        catch { accountsError = SettingsStore.message(error).text }
    }

    private func loadSetup() async {
        setupBusy = true; setupError = nil
        defer { setupBusy = false }
        do {
            let value = try await store.pluginSetup(plugin)
            setup = value
            scheme = value.schemes.first(where: { $0.supported })?.scheme ?? ""
        } catch { setupError = SettingsStore.message(error).text }
    }

    private var buttonTitle: String {
        if connecting { return "Öffnet …" }
        switch plugin.connectionStatus {
        case "connected": return "Verbunden"
        case "pending": return "Fortsetzen"
        case "unavailable": return "Details"
        default: return plugin.authMode == "setup_required" ? "Einrichten" : "Verbinden"
        }
    }
}

// Farbiges Logo für jede Kachel: mitgelieferte Logos zuerst, dann die Adresse des Anbieters, dann das Website-Symbol des Dienstes.
struct PluginLogo: View {
    let slug: String, name: String, url: String?
    private static let local: [(String, String)] = [
        ("googlecalendar", "logo-gcal"), ("googledrive", "logo-drive"), ("gmail", "logo-gmail"), ("notion", "logo-notion"),
        ("github", "logo-github"), ("linear", "logo-linear"), ("outlook", "logo-outlook"), ("spotify", "logo-spotify"),
        ("composio", "logo-composio"), ("nango", "logo-nango"), ("pipedream", "logo-pipedream"),
    ]
    private var asset: String? {
        let key = slug.lowercased().filter(\.isLetter)
        return Self.local.first { key.hasPrefix($0.0) }?.1
    }
    private var favicon: URL? {
        let domain = slug.lowercased().filter(\.isLetter)
        return URL(string: "https://www.google.com/s2/favicons?domain=\(domain).com&sz=128")
    }
    var body: some View {
        if let asset { Image(asset).resizable().interpolation(.high).scaledToFit() }
        else {
            AsyncImage(url: URL(string: url ?? "")) { $0.resizable().scaledToFit() } placeholder: {
                AsyncImage(url: favicon) { $0.resizable().scaledToFit() } placeholder: {
                    Text(String(name.prefix(1))).font(Theme.Fonts.bodyMedium).foregroundStyle(Theme.Palette.mutedForeground)
                }
            }
        }
    }
}


// Gemeinsame Bauteile des Marktplatzes (Figma 192:18885 Hell, 192:19039 Dunkel).

// Kategorie-Chip (192:18905): 31 hoch, innen 8/13, r8, gewählt secondary + 12 Semibold foreground, sonst 12 Regular muted, ohne Rand.
struct MarketChipStyle: ButtonStyle {
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(selected ? Theme.Fonts.geist(Theme.Fonts.size12, .semibold) : Theme.Fonts.small)
            .foregroundStyle(selected ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
            .padding(.horizontal, Theme.Metrics.pt13).padding(.vertical, Theme.Metrics.pt8)
            .background(selected || configuration.isPressed ? Theme.Palette.secondary : .clear, in: .rect(cornerRadius: Theme.Radius.md))
            .contentShape(.rect)
    }
}

// Kachel-Knopf (192:18931): 29 hoch (11 Medium + innen 8/10), r8, secondary.
struct MarketTileButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.foreground)
            .padding(.horizontal, Theme.Metrics.pt10).padding(.vertical, Theme.Metrics.pt8)
            .background(Theme.Palette.secondary.opacity(configuration.isPressed ? 0.7 : 1), in: .rect(cornerRadius: Theme.Radius.md))
            .opacity(enabled ? 1 : Theme.Opacity.disabled)
            .contentShape(.rect)
    }
}

// Verbunden: Punkt statusInfo 6 + „Verbunden“ 11 Medium statt Knopf.
struct MarketConnectedLabel: View {
    var action: (() -> Void)?
    var body: some View {
        let label = HStack(spacing: Theme.Metrics.pt6) {
            Circle().fill(Theme.Palette.statusInfo).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6)
            Text("Verbunden").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.foreground)
        }
        if let action { Button(action: action) { label }.buttonStyle(.plain) } else { label }
    }
}

// Logo-Fläche: 42 secondary r10, Logo 28.
struct MarketTileLogo<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        content
            .frame(width: Theme.PluginStore.logoSize, height: Theme.PluginStore.logoSize)
            .frame(width: Theme.PluginStore.logoFrame, height: Theme.PluginStore.logoFrame)
            .background(Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Radius.lg))
            .accessibilityHidden(true)
    }
}

// Name 14 Semibold, Beschreibung 11 muted einzeilig, Abstand 5.
struct MarketTileText: View {
    let title: String
    let text: String
    var status = ""
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt5) {
            Text(title).font(Theme.Fonts.geist(Theme.Fonts.size14, .semibold)).lineLimit(1)
            Text(text).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1).help(text)
            if !status.isEmpty { Text(status).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    // Die eine Kachel-Bauweise: card, r12, Rand border 1, innen 16, mindestens 112 hoch.
    func marketTile() -> some View {
        padding(Theme.Spacing.lg)
            .frame(maxWidth: .infinity, minHeight: Theme.PluginStore.cardHeight, alignment: .leading)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.tile))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.tile).strokeBorder(Theme.Palette.border, lineWidth: Theme.PluginStore.borderWidth) }
    }
}
