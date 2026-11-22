import SwiftUI

// Reiter „Marktplatz“ (marketplace-section.tsx): Katalog mit Rechten und Quelle, Installieren legt Skill oder Konnektor an.
struct SettingsMarketplaceView: View {
    let store: SettingsStore
    var loadCatalogDuringStaticRendering = false
    // Reiter „Plugins | Skills“ unter dem Titel (setzt SettingsView).
    var tabs: AnyView?
    @Environment(\.settingsConfirm) private var confirm
    @Environment(\.staticRendering) private var staticRendering

    @State private var search = ""
    // Startseite „Alle“ (oben die Empfohlenen); "connected" = eigene Seite Verbunden, sonst die Kategorie-ID aus dem Dienst.
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

    private var trimmedSearch: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var searching: Bool { !trimmedSearch.isEmpty }
    // Startseite: Alle ohne Suche. Dort stehen oben die Empfohlenen (die ersten recommendedCount Einträge), darunter alle Dienste.
    private var onStartPage: Bool { category.isEmpty && !searching }
    private var onConnectedPage: Bool { category == "connected" }
    // Composio-Karte und Apple Kalender stehen als normale Kacheln vorn in Alle (Empfohlen, Suche).
    private var leadsGrid: Bool { category.isEmpty }
    // Steht der Composio-Zugang (Schlüsselbund oder secrets.env), ist Composio fest in Orbit: keine Einrichtungskarte, alle Anbieter stehen direkt im Katalog.
    private var showComposio: Bool { !store.pluginsConfigured && leadsGrid && (search.isEmpty || "Composio".localizedStandardContains(search)) }
    private var showApple: Bool { (leadsGrid || (onConnectedPage && appleConnected)) && (search.isEmpty || "Apple Kalender".localizedStandardContains(search)) }

    // Der Dienst filtert Suche und Kategorie; die Ansicht teilt nur noch in Empfohlen und den Rest (verbundene Dienste bleiben in der Liste).
    private var visiblePlugins: [PluginEntry] {
        (store.plugins.value ?? []).filter { !OrbitBuiltIns.isHidden(source: $0.source) }
    }
    private var recommendedPlugins: [PluginEntry] {
        guard onStartPage else { return [] }
        return (store.plugins.value ?? []).prefix(store.pluginRecommended).filter { !OrbitBuiltIns.isHidden(source: $0.source) }
    }
    private var restPlugins: [PluginEntry] {
        guard onStartPage else { return visiblePlugins }
        return (store.plugins.value ?? []).dropFirst(store.pluginRecommended).filter { !OrbitBuiltIns.isHidden(source: $0.source) }
    }
    private var connectedExtraCount: Int { (showApple && appleConnected ? 1 : 0) + visiblePlugins.count }
    private var catalogTitle: String {
        if searching { return "Ergebnisse" }
        if category.isEmpty { return "Alle Dienste" }
        return store.pluginGroups.first { $0.id == category }?.name ?? "Dienste"
    }

    var body: some View {
        ScrollViewReader { page in content(page) }
    }

    private func content(_ page: ScrollViewProxy) -> some View {
        // Figma Marktplatz (192:18895): Abstand 20; Kopf Abstand 7, Untertitel 13 Regular.
        VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt7) {
                Text("Marktplatz").font(Theme.Fonts.settingsTitle).accessibilityAddTraits(.isHeader)
                Text(store.showSkills ? "Feste Anleitungen, die jeder Orbi mit /name abrufen kann." : "Dienste für deine Orbis verbinden.").font(Theme.Fonts.subhead).foregroundStyle(Theme.Palette.mutedForeground)
            }
            .id(Self.topAnchor)
            if let tabs { tabs }
            // Reiter Skills: eigene Liste; Kopf und Reiter bleiben stehen, damit die Pille gleitet und Suche/Filter erhalten bleiben.
            if store.showSkills {
                SettingsSkillsSection(store: store)
                    .frame(maxWidth: Theme.Layout.settingsContent, alignment: .leading)
            } else {
                plugins(page)
            }
        }
        .task { if !staticRendering { appleConnected = store.appleCalendarConfigured } }
        .task(id: search + "|" + category) {
            guard !staticRendering || loadCatalogDuringStaticRendering else { return }
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            await store.loadPlugins(search: search, category: category)
        }
    }

    @ViewBuilder private func plugins(_ page: ScrollViewProxy) -> some View {
        Group {
                // Suchfeld (192:18899): 44 hoch, innen 0/14, Abstand 10, Lupe 16, Text 13.
                HStack(spacing: Theme.Metrics.pt10) {
                    Image(systemName: "magnifyingglass").font(.system(size: Theme.Metrics.pt16, weight: Theme.Icon.weight)).foregroundStyle(Theme.Palette.mutedForeground)
                    TextField("Dienste suchen", text: $search, prompt: Text("Dienste suchen").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).font(Theme.Fonts.subhead).accessibilityLabel("Dienste suchen")
                    if !search.isEmpty {
                        Button { search = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).accessibilityLabel("Suche leeren")
                    }
                }
                .padding(.horizontal, Theme.Metrics.pt14).frame(height: Theme.Metrics.pt44)
                .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
                .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.PluginStore.borderWidth) }
                // Immer eine Reihe: Kategorien scrollen (der gewählte Chip rückt ins Bild), „Verbunden“ steht rechts fest.
                // Vorher ViewThatFits mit zwei Varianten: beim Wechsel baute sich die Reihe neu auf und die Pille sprang.
                HStack(spacing: Theme.Metrics.pt8) {
                    ScrollViewReader { chips in
                        ScrollView(.horizontal) { HStack(spacing: Theme.Metrics.pt8) { categoryChips }.slidingPill(trigger: category) }
                            .scrollIndicators(.never)
                            // Weiche Kante rechts: abgeschnittene Kategorien sehen nach „mehr“ aus, nicht nach Fehler (Sol-Rundgang).
                            .mask(HStack(spacing: Theme.Metrics.pt0) {
                                Rectangle()
                                LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: Theme.Metrics.pt24)
                            })
                            .onChange(of: category) { _, value in
                                guard !staticRendering else { return }
                                withAnimation(Theme.Motion.pill) { chips.scrollTo(value, anchor: .center) }
                            }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    categoryButton("Verbunden", id: "connected").slidingPill(trigger: category)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .onChange(of: category) { _, _ in
                    guard !staticRendering else { return }
                    page.scrollTo(Self.topAnchor, anchor: .top)
                }
                if let error = store.pluginError { SettingsAlert(text: error) }
                if let notice = store.pluginNotice { SettingsHint(text: notice) }
                // Seite Verbunden: nur Verbundene (auch Apple Kalender). Sonst Empfohlen (nur Start) und Katalog.
                VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    if onConnectedPage {
                        VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
                            if connectedExtraCount == 0, store.plugins.value != nil {
                                SettingsHint(text: search.isEmpty ? "Noch nichts verbunden." : "Keine passenden verbundenen Dienste.")
                            }
                            if connectedExtraCount > 0 {
                                MarketSection(title: "Verbunden", count: connectedExtraCount) {
                                    MarketGrid {
                                        if showApple && appleConnected { appleCard }
                                        ForEach(visiblePlugins) { pluginCard($0) }
                                    }
                                }
                            }
                        }
                        connectedPage
                    } else { pluginCatalog }
                }
        }
    }

    private static let topAnchor = "marktplatz-oben"


    private func pluginCard(_ plugin: PluginEntry) -> some View {
        PluginStoreCard(plugin: plugin, store: store, busy: store.connectingPlugin != nil || store.disconnectingPlugin != nil, connecting: store.connectingPlugin == plugin.id) {
            Task { await store.connect(plugin) }
        }
    }

    private var appleCard: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt10) {
            HStack(spacing: Theme.Metrics.pt10) {
                MarketTileLogo { PluginLogo(slug: "apple", name: "Apple Kalender", url: nil, asset: "logo-apple") }
                MarketTileText(title: "Apple Kalender", text: "iCloud mit app-spezifischem Passwort verbinden", state: appleConnected ? .connected : .none)
                    .help(appleConnected ? "Zugang gespeichert · Verbindung im Chat prüfen" : "iCloud mit app-spezifischem Passwort verbinden")
                let toggleSetup = { showAppleSetup.toggle(); appleMessage = nil; if !showAppleSetup { applePassword = "" } }
                if appleConnected { MarketConnectedLabel(action: toggleSetup) }
                else { Button(showAppleSetup ? "Schließen" : "Verbinden", action: toggleSetup).buttonStyle(MarketActionButtonStyle(kind: showAppleSetup ? .secondary : .primary)) }
            }
            if showAppleSetup {
                MarketDetailBlock {
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
                        }.buttonStyle(MarketActionButtonStyle(kind: .primary)).disabled(appleBusy || appleId.isEmpty || applePassword.isEmpty)
                        if appleConnected {
                            Button("Trennen") {
                                appleMessage = store.disconnectAppleCalendar() ?? "Zugang entfernt."
                                applePassword = ""; appleConnected = store.appleCalendarConfigured
                            }.buttonStyle(MarketActionButtonStyle(kind: .secondary)).disabled(appleBusy)
                        }
                    }
                }
            }
        }
        .marketTile()
        .marketTileAccessibility(name: "Apple Kalender", status: appleConnected ? "verbunden" : "")
        .layoutValue(key: MarketFullWidth.self, value: showAppleSetup)
    }

    private var composioCard: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt10) {
            HStack(spacing: Theme.Metrics.pt10) {
                MarketTileLogo { PluginLogo(slug: "composio", name: "Composio", url: nil, asset: "logo-composio") }
                MarketTileText(title: "Composio", text: store.pluginsConfigured ? "Eingerichtet · Weitere Dienste entdecken" : "Weitere Dienste für Orbit entdecken")
                Button(showComposioSetup ? "Schließen" : store.pluginsConfigured ? "Verwalten" : "Verbinden") { showComposioSetup.toggle(); if !showComposioSetup { composioKey = "" } }
                    .buttonStyle(MarketActionButtonStyle(kind: store.pluginsConfigured || showComposioSetup ? .secondary : .primary))
            }
            if showComposioSetup {
                MarketDetailBlock {
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
                    }.buttonStyle(MarketActionButtonStyle(kind: .primary)).disabled(composioBusy || composioKey.isEmpty)
                }
            }
        }
        .marketTile()
        .marketTileAccessibility(name: "Composio", status: store.pluginsConfigured ? "eingerichtet" : "nicht eingerichtet")
        .layoutValue(key: MarketFullWidth.self, value: showComposioSetup)
    }

    @ViewBuilder private var categoryChips: some View {
        categoryButton("Alle", id: "")
        ForEach(store.pluginGroups) { group in categoryButton(group.name, id: group.id) }
    }

    private func categoryButton(_ name: String, id: String) -> some View {
        Button(name) { category = id }.buttonStyle(MarketChipStyle(selected: category == id))
        .accessibilityAddTraits(category == id ? .isSelected : [])
        .id(id)
    }

    // Seite Verbunden: nur Fehler und Nachladen; die Kacheln stehen im Abschnitt darüber.
    @ViewBuilder private var connectedPage: some View {
        switch store.plugins {
        case .idle, .loading:
            SettingsSkeleton(height: Theme.PluginStore.cardHeight, radius: Theme.Radius.tile)
                .accessibilityElement(children: .ignore).accessibilityLabel("Dienste werden geladen")
        case .failed(let message, let offline):
            SettingsFailure(message: message, offline: offline) { Task { await store.loadPlugins() } }
        case .loaded:
            loadMore(loaded: visiblePlugins.count)
        }
    }

    // Startseite: Empfohlen (die ersten recommendedCount Einträge, Apple Kalender und Composio ganz vorn), darunter „Alle Dienste · N“.
    // Mit Kategorie oder Suche nur eine Liste („Ergebnisse · N“ bzw. Kategoriename). Verbundene Dienste bleiben in den Listen.
    private var pluginCatalog: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt20) { pluginCatalogSections }
    }

    @ViewBuilder private var pluginCatalogSections: some View {
        switch store.plugins {
        case .idle, .loading:
            MarketSection(title: catalogTitle) {
                MarketGrid { ForEach(0..<6, id: \.self) { _ in SettingsSkeleton(height: Theme.PluginStore.cardHeight, radius: Theme.Radius.tile) } }
            }
            .accessibilityElement(children: .ignore).accessibilityLabel("Dienste werden geladen")
        case .failed(let message, let offline):
            SettingsFailure(message: message, offline: offline) { Task { await store.loadPlugins() } }
        case .loaded:
            if !store.pluginsConfigured {
                SettingsHint(text: "Composio ist noch nicht eingerichtet. Schlüssel hinterlegen, um weitere Dienste zu sehen.")
            }
            let featured = recommendedPlugins, rest = restPlugins
            let leading = (showComposio ? 1 : 0) + (showApple ? 1 : 0)
            if visiblePlugins.isEmpty && leading == 0 { SettingsHint(text: "Keine passenden Dienste gefunden.") }
            // Empfohlen nur mit Einträgen vom Dienst; Composio und Apple Kalender stehen dann hier, sonst vorn in „Alle Dienste“.
            let leadsFeatured = !featured.isEmpty
            if leadsFeatured {
                MarketSection(title: "Empfohlen") {
                    MarketGrid {
                        leadingTiles
                        ForEach(featured) { pluginCard($0) }
                    }
                }
            }
            if !rest.isEmpty || store.pluginCursor != nil || (!leadsFeatured && leading > 0) {
                // Zähler: exakt vom Dienst (totalItems).
                MarketSection(title: catalogTitle, count: store.pluginTotal ?? rest.count, more: store.pluginTotal == nil && store.pluginCursor != nil) {
                    MarketGrid {
                        if !leadsFeatured { leadingTiles }
                        ForEach(rest) { pluginCard($0) }
                    }
                    loadMore(loaded: visiblePlugins.count)
                }
            }
        }
    }

    @ViewBuilder private var leadingTiles: some View {
        if showComposio { composioCard }
        if showApple { appleCard }
    }

    // „Weitere Dienste laden“: ruhiger Knopf in der Mitte; erreicht der Knopf den sichtbaren Bereich, lädt Orbit selbst nach (nie im Selbsttest).
    @ViewBuilder private func loadMore(loaded: Int) -> some View {
        if store.pluginCursor != nil {
            VStack(spacing: Theme.Metrics.pt6) {
                Button(store.pluginLoadingMore ? "Wird geladen …" : "Weitere Dienste laden") { Task { await store.loadPlugins(more: true) } }
                    .buttonStyle(MarketActionButtonStyle(kind: .secondary)).disabled(store.pluginLoadingMore)
                Text("\(loaded) Dienste geladen").font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground)
                LazyVStack(spacing: Theme.Metrics.pt0) {
                    Color.clear.frame(height: Theme.Metrics.pt1)
                        .onAppear {
                            guard !staticRendering, !store.pluginLoadingMore else { return }
                            Task { await store.loadPlugins(more: true) }
                        }
                        .id(loaded)
                }
            }
            .frame(maxWidth: .infinity).padding(.top, Theme.Metrics.pt8)
        }
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

    private var tileState: MarketTileState {
        switch plugin.connectionStatus {
        case "connected": .connected
        case "pending": .pending
        default: .none
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt10) {
            HStack(spacing: Theme.Metrics.pt10) {
                MarketTileLogo { PluginLogo(slug: plugin.slug, name: plugin.name, url: plugin.logoUrl) }
                MarketTileText(title: plugin.name, text: plugin.connectionStatus == "unavailable" ? plugin.statusText : plugin.description, state: tileState)
                    .help(plugin.statusText.isEmpty ? plugin.description : plugin.description + " · " + plugin.statusText)
                trailing
            }
            if showAccounts { accountsBlock }
            if showSetup { setupBlock }
        }
        .marketTile()
        .marketTileAccessibility(name: plugin.name, status: plugin.statusText)
        // „Trennen …“ (nur im Code, nicht in Figma): hinter Rechtsklick; dasselbe steht im Menü der verbundenen Kachel.
        .webContextMenu(screenName: "kontext-marktplatz") {
            let linked = plugin.connectionStatus == "connected" || plugin.connectionStatus == "pending"
            return [WebMenuItem(title: linked ? "Trennen …" : "Konten verwalten", icon: linked ? "xmark.circle" : "person.2", disabled: busy || accountsBusy) {
                toggleAccounts()
            }]
        }
        // Als Letztes, damit der Rasterbau den Wert sieht (der Rechtsklick-Rahmen verdeckt ihn sonst).
        .layoutValue(key: MarketFullWidth.self, value: showAccounts || showSetup)
    }

    // Verbunden: Menü „Verwalten“. Sonst ein Hauptknopf („Verbinden“; bei Zugangsdaten öffnet er das Einrichtungsfeld in der Kachel).
    @ViewBuilder private var trailing: some View {
        if plugin.connectionStatus == "connected" {
            MarketMoreMenu(label: "\(plugin.name): Verwalten") {
                Button(showAccounts ? "Konten ausblenden" : "Konten verwalten") { toggleAccounts() }
            }.disabled(busy)
        } else {
            Button(buttonTitle, action: primaryAction)
                .buttonStyle(MarketActionButtonStyle(kind: buttonTitle == "Verbinden" ? .primary : .secondary))
                .disabled(busy).accessibilityLabel("\(plugin.name): \(buttonTitle)")
        }
    }

    private func primaryAction() {
        if plugin.authMode == "setup_required" || plugin.connectionStatus == "unavailable" {
            showSetup.toggle()
            if !showSetup { fields.removeAll(); setupError = nil }
            if showSetup && setup == nil { Task { await loadSetup() } }
        } else { connect() }
    }

    private func toggleAccounts() {
        showAccounts.toggle()
        if showAccounts { Task { await loadAccounts() } }
    }

    private var accountsBlock: some View {
        MarketDetailBlock {
            Button("Weiteres Konto verbinden") {
                if plugin.authMode == "setup_required" {
                    showSetup = true
                    if setup == nil { Task { await loadSetup() } }
                } else { Task { await store.connect(plugin, additional: true) } }
            }
            .buttonStyle(MarketActionButtonStyle(kind: .secondary)).disabled(busy || accountsBusy)
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
                .buttonStyle(MarketActionButtonStyle(kind: .secondary))
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
    }

    private var setupBlock: some View {
        MarketDetailBlock {
            SettingsHint(text: "Dieser Dienst braucht zusätzliche Angaben, die an Composio gehen.", small: true)
            if let setupError { SettingsAlert(text: setupError) }
            if let setup {
                if !setup.schemes.contains(where: { $0.supported }) { SettingsHint(text: "Einrichtung in Orbit noch nicht verfügbar. Bitte die Anleitung bei Composio nutzen.", small: true) }
                if setup.schemes.count > 1 {
                    WebSelect(options: setup.schemes.filter(\.supported).map { ($0.scheme, $0.scheme) }, selection: $scheme, small: true, label: "Anmeldung")
                        .onChange(of: scheme) { _, _ in fields.removeAll() }
                }
                if let selected = setup.schemes.first(where: { $0.scheme == scheme }) {
                    if selected.scheme == "OAUTH2", let redirect = setup.oauthRedirectUrl {
                        SettingsHint(text: "Rücksprung-Adresse (mit der Anbieteranleitung prüfen):", small: true)
                        Text(redirect).font(Theme.Fonts.small).textSelection(.enabled)
                    }
                    ForEach(selected.configFields) { field in
                        if field.type == "boolean" {
                            HStack(spacing: Theme.Metrics.pt8) {
                                Text(field.label).font(Theme.Fonts.small)
                                WebSelect(options: [("", "Bitte wählen"), ("true", "Ja"), ("false", "Nein")],
                                          selection: Binding(get: { fields[field.name] ?? "" }, set: { fields[field.name] = $0 }), small: true, label: field.label)
                                    .fixedSize()
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
                            if setupError == nil { showSetup = false }
                            fields.removeAll()
                            setupBusy = false
                        }
                    }.buttonStyle(MarketActionButtonStyle(kind: .primary))
                        .disabled(setupBusy || !selected.supported || selected.configFields.contains(where: { $0.required && (fields[$0.name] ?? "").isEmpty }))
                }
                if let guide = setup.guideUrl, let url = URL(string: guide), url.scheme == "https", url.host?.hasSuffix(".composio.dev") == true || url.host == "composio.dev" {
                    Link("Anleitung öffnen", destination: url)
                }
            } else if setupBusy { SettingsHint(text: "Einrichtung wird geladen …", small: true) }
            Link("Composio öffnen", destination: URL(string: "https://dashboard.composio.dev/")!)
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
        if showSetup { return "Schließen" }
        switch plugin.connectionStatus {
        case "connected": return "Verbunden"
        case "pending": return "Fortsetzen"
        case "unavailable": return "Details"
        default: return "Verbinden"
        }
    }
}

// Logo für jede Kachel, immer sichtbar: mitgeliefertes Bild (nur wenn es existiert), sonst Logo-Adresse (Composio-Logodienst),
// sonst Website-Symbol, sonst Monogramm. Das Ergebnis füllt die 40 × 40 große Logo-Fläche (MarketTileLogo).
struct PluginLogo: View {
    let slug: String, name: String, url: String?
    var asset: String?
    private static let local: [(String, String)] = [
        ("googlecalendar", "logo-gcal"), ("googledrive", "logo-drive"), ("gmail", "logo-gmail"), ("notion", "logo-notion"),
        ("github", "logo-github"), ("linear", "logo-linear"), ("outlook", "logo-outlook"), ("spotify", "logo-spotify"),
        ("composio", "logo-composio"), ("apple", "logo-apple"),
    ]
    private var key: String { slug.lowercased().filter(\.isLetter) }
    private var resolvedAsset: String? {
        guard let candidate = asset ?? Self.local.first(where: { key.hasPrefix($0.0) })?.1 else { return nil }
        return NSImage(named: candidate) == nil ? nil : candidate
    }
    private var logoURL: URL? {
        if let url, let parsed = URL(string: url), parsed.scheme == "https", !url.isEmpty { return parsed }
        return key.isEmpty ? nil : URL(string: "https://logos.composio.dev/api/\(key)")
    }
    // Website-Symbol als letzter Rückfall: bekannte Hosts für die Google-Dienste, sonst <slug>.com. Unbekannte Seiten antworten 404 (dann Monogramm).
    private static let hosts = ["gmail": "mail.google.com", "googlecalendar": "calendar.google.com", "googledrive": "drive.google.com",
                                "outlook": "outlook.office.com", "apple": "apple.com", "applecalendar": "icloud.com"]
    private var favicon: URL? {
        guard !key.isEmpty else { return nil }
        let host = Self.hosts[key] ?? key + ".com"
        return URL(string: "https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://\(host)&size=128")
    }
    private var size: CGFloat { Theme.PluginStore.logoFrame }

    var body: some View {
        Group {
            if let resolvedAsset { Image(resolvedAsset).resizable().interpolation(.high).scaledToFill() }
            else {
                AsyncImage(url: logoURL) { phase in
                    switch phase {
                    case .success(let image): image.resizable().interpolation(.high).scaledToFit().padding(Theme.Metrics.pt6)
                    case .failure:
                        AsyncImage(url: favicon) { fallback in
                            if case .success(let image) = fallback { image.resizable().interpolation(.high).scaledToFit().padding(Theme.Metrics.pt6) }
                            else { monogram }
                        }
                    default: monogram
                    }
                }
            }
        }
        .frame(width: size, height: size)
    }

    private var monogram: some View {
        ZStack {
            Theme.Palette.secondary
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                .font(Theme.Fonts.geist(Theme.Fonts.size16, .semibold)).foregroundStyle(Theme.Palette.mutedForeground)
        }
    }
}

// Gemeinsame Bauteile des Marktplatzes (Figma 192:18885 Hell, 192:19039 Dunkel), Kacheln neu gestaltet 09.11.2026.

// Kategorie-Chip (192:18905): 31 hoch, innen 8/13, r8, gewählt secondary + 12 Semibold foreground, sonst 12 Regular muted, ohne Rand.
struct MarketChipStyle: ButtonStyle {
    let selected: Bool
    func makeBody(configuration: Configuration) -> some View {
        // Breite fest wie fett (unsichtbare fette Kopie): sonst wird der gewählte Chip breiter, die Reihe rechnet ihr Layout
        // neu und die gleitende Pille springt (Rundgang 16.11.2026).
        ZStack {
            configuration.label.font(Theme.Fonts.geist(Theme.Fonts.size12, .semibold)).hidden()
            configuration.label.font(selected ? Theme.Fonts.geist(Theme.Fonts.size12, .semibold) : Theme.Fonts.small)
        }
            .foregroundStyle(selected ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
            .padding(.horizontal, Theme.Metrics.pt13).padding(.vertical, Theme.Metrics.pt8)
            // Gewählt zeichnet die gleitende Pille der Chip-Reihe (slidingPill), hier nur gedrückt.
            .background(!selected && configuration.isPressed ? Theme.Palette.secondary : .clear, in: .rect(cornerRadius: Theme.Radius.md))
            .pillTarget(selected, radius: Theme.Radius.md, fill: Theme.Palette.secondary)
            .contentShape(.rect)
    }
}

// Knopf der Kacheln: Radius 8 (Consti 07.11.), 28 hoch, 12 Medium. Hauptknopf neutral gefüllt (foreground), zweiter Knopf secondaryRaised mit feinem Rand.
// Hover und gedrückt (1 pt tiefer) sichtbar; Tastaturfokus mit eigenem 2-pt-Ring; deaktiviert 40 %.
struct MarketActionButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary }
    var kind: Kind = .primary
    func makeBody(configuration: Configuration) -> some View { MarketActionButtonBody(configuration: configuration, kind: kind) }
}

private struct MarketActionButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: MarketActionButtonStyle.Kind
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused

    var body: some View {
        configuration.label
            .font(Theme.Fonts.geist(Theme.Fonts.size12, .medium)).lineLimit(1).fixedSize()
            .foregroundStyle(kind == .primary ? Theme.Palette.background : Theme.Palette.secondaryForeground)
            .padding(.horizontal, Theme.Metrics.pt11)
            .frame(height: Theme.PluginStore.buttonHeight)
            .background(fill, in: .rect(cornerRadius: Theme.Radius.md))
            .overlay { if kind == .secondary { RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) } }
            .overlay { if focused { RoundedRectangle(cornerRadius: Theme.Radius.md + Theme.Metrics.pt2).strokeBorder(Theme.Palette.foreground.opacity(0.6), lineWidth: Theme.Metrics.pt2).padding(-Theme.Metrics.pt2) } }
            .contentShape(.rect(cornerRadius: Theme.Radius.md))
            .offset(y: configuration.isPressed ? Theme.Motion.pressOffset : 0)
            .opacity(enabled ? 1 : Theme.Opacity.disabled)
            .focusEffectDisabled()
            .onHover { hover = $0 && enabled }
            .animation(Theme.Motion.hover.animation, value: hover)
            .animation(Theme.Motion.hover.animation, value: configuration.isPressed)
    }

    private var fill: Color {
        switch kind {
        case .primary: Theme.Palette.foreground.opacity(configuration.isPressed ? 0.7 : hover ? 0.85 : 1)
        case .secondary: configuration.isPressed ? Theme.Palette.input : hover ? Theme.Palette.secondaryRaisedHover : Theme.Palette.secondaryRaised
        }
    }
}

// Alter Name des Kachel-Knopfs (Legacy-Karten); gleicher Stil wie der zweite Knopf.
struct MarketTileButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { MarketActionButtonBody(configuration: configuration, kind: .secondary) }
}

// Verbunden: Knopf „Verwalten“ (zweiter Stil). Ohne Aktion nur Punkt + „Verbunden“.
struct MarketConnectedLabel: View {
    var action: (() -> Void)?
    var body: some View {
        if let action { Button("Verwalten", action: action).buttonStyle(MarketActionButtonStyle(kind: .secondary)) }
        else {
            HStack(spacing: Theme.Metrics.pt6) {
                Circle().fill(Theme.Palette.statusSuccess).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6)
                Text("Verbunden").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.foreground)
            }
        }
    }
}

// Menü einer verbundenen Kachel: runder Symbolknopf 28 × 28 mit „…“.
struct MarketMoreMenu<Items: View>: View {
    let label: String
    @ViewBuilder let items: Items
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Menu { items } label: {
            Image(systemName: "ellipsis").font(.system(size: Theme.Metrics.pt14, weight: Theme.Icon.weight))
                .foregroundStyle(Theme.Palette.secondaryForeground)
                .frame(width: Theme.PluginStore.buttonHeight, height: Theme.PluginStore.buttonHeight)
                .background(hover ? Theme.Palette.secondaryRaisedHover : Theme.Palette.secondaryRaised, in: Circle())
                .overlay { Circle().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
                .contentShape(Circle())
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .opacity(enabled ? 1 : Theme.Opacity.disabled)
        .onHover { hover = $0 && enabled }
        .animation(Theme.Motion.hover.animation, value: hover)
        .accessibilityLabel(label).help("Verwalten")
    }
}

// Logo-Fläche: 40 × 40, r10, neutral weiß (helle und dunkle Logos bleiben sichtbar), feiner Rand.
struct MarketTileLogo<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        content
            .frame(width: Theme.PluginStore.logoFrame, height: Theme.PluginStore.logoFrame)
            .background(Color.white)
            .clipShape(.rect(cornerRadius: Theme.Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
            .accessibilityHidden(true)
    }
}

enum MarketTileState { case none, connected, pending }

// Name 13 Semibold, darunter eine Zeile 11 muted (bei Verbunden / Wartet auf Anmeldung stattdessen Punkt + Status).
struct MarketTileText: View {
    let title: String
    let text: String
    var status = ""
    var state: MarketTileState = .none
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
            Text(title).font(Theme.Fonts.geist(Theme.Fonts.size13, .semibold)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            switch state {
            case .connected: statusLine("Verbunden", color: Theme.Palette.statusSuccess)
            case .pending: statusLine("Wartet auf Anmeldung", color: Theme.Palette.statusWarning)
            case .none: Text(text).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
            }
            if !status.isEmpty { Text(status).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
    }

    private func statusLine(_ label: String, color: Color) -> some View {
        HStack(spacing: Theme.Metrics.pt5) {
            Circle().fill(color).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6)
            Text(label).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
        }
    }
}

// Eingerückter Block innerhalb einer aufgeklappten Kachel (Einrichtung, Konten): fluchtet mit dem Text, höchstens 560 breit.
struct MarketDetailBlock<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) { content }
            .font(Theme.Fonts.small)
            .padding(Theme.Metrics.pt12)
            .frame(maxWidth: Theme.Metrics.pt560, alignment: .leading)
            .background(Theme.Palette.secondaryRaised.opacity(0.6), in: .rect(cornerRadius: Theme.Radius.lg))
            .padding(.leading, Theme.PluginStore.logoFrame + Theme.Metrics.pt12)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Abschnitt mit kleiner Überschrift und Zähler („Alle Dienste · 1700“, mit „+“ nur, wenn die Zahl nicht exakt ist).
struct MarketSection<Content: View>: View {
    let title: String
    var count: Int?
    var more = false
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt10) {
            HStack(spacing: Theme.Metrics.pt6) {
                Text(title).font(Theme.Fonts.geist(Theme.Fonts.size14, .semibold))
                if let count { Text("· \(count)\(more ? "+" : "")").font(Theme.Fonts.geist(Theme.Fonts.size13, .medium)).foregroundStyle(Theme.Palette.mutedForeground) }
            }
            .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
            content
        }
    }
}

// Raster: so viele Spalten wie passen (mindestens 256 breit, bei 855 also 3, bei 528 also 2). Eine aufgeklappte Kachel
// (layoutValue MarketFullWidth) nimmt eine ganze Zeile. Alle Kacheln behalten dabei ihre Identität und ihren Zustand.
struct MarketFullWidth: LayoutValueKey { static let defaultValue = false }

struct MarketFlowLayout: Layout {
    var minColumn = Theme.PluginStore.columnMinWidth
    var spacing = Theme.PluginStore.gridSpacing

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
        let columns = max(1, Int(((width + spacing) / (minColumn + spacing)).rounded(.down)))
        let columnWidth = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        var frames = [CGRect](repeating: .zero, count: subviews.count)
        var row: [Int] = []
        var y: CGFloat = 0
        func closeRow() {
            guard !row.isEmpty else { return }
            let height = row.map { frames[$0].height }.max() ?? 0
            for index in row { frames[index].size.height = height }
            y += height + spacing
            row.removeAll()
        }
        for (index, subview) in subviews.enumerated() {
            if subview[MarketFullWidth.self] {
                closeRow()
                let height = subview.sizeThatFits(ProposedViewSize(width: width, height: nil)).height
                frames[index] = CGRect(x: 0, y: y, width: width, height: height)
                y += height + spacing
            } else {
                let height = subview.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil)).height
                frames[index] = CGRect(x: CGFloat(row.count) * (columnWidth + spacing), y: y, width: columnWidth, height: height)
                row.append(index)
                if row.count == columns { closeRow() }
            }
        }
        closeRow()
        return (frames, max(0, y - spacing))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? minColumn
        return CGSize(width: width, height: arrange(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, subview) in subviews.enumerated() {
            let frame = result.frames[index]
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(width: frame.width, height: frame.height))
        }
    }
}

struct MarketGrid<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View { MarketFlowLayout { content } }
}

extension View {
    // Die eine Kachel-Bauweise: card, r12, Rand border 1 (bei Hover kräftiger), innen 12/10, mindestens 76 hoch.
    func marketTile() -> some View { modifier(MarketTileSurface()) }

    // Eine Sprachausgabe-Einheit je Kachel: Name + Status; die Knöpfe darin bleiben einzeln erreichbar.
    func marketTileAccessibility(name: String, status: String) -> some View {
        accessibilityElement(children: .contain).accessibilityLabel(status.isEmpty ? name : "\(name), \(status)")
    }
}

private struct MarketTileSurface: ViewModifier {
    @State private var hover = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt10)
            .frame(maxWidth: .infinity, minHeight: Theme.PluginStore.cardHeight, maxHeight: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.tile))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.tile).strokeBorder(hover ? Theme.Palette.input : Theme.Palette.border, lineWidth: Theme.PluginStore.borderWidth) }
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover)
    }
}
