import SwiftUI

// Abschnitt „Anbieter“ im Marktplatz: Einrichten, Verbinden, Testlesen, Trennen. Beim Öffnen wird nur die Liste geladen.
struct SettingsProvidersView<Extras: View>: View {
    // Weitere Kacheln (Composio, Apple Kalender) laufen im selben Raster.
    private let extras: Extras
    @State private var model: ProvidersStore
    @Environment(\.settingsConfirm) private var confirm
    @Environment(\.staticRendering) private var staticRendering
    // Eingaben nur bis zum Speichern; danach sofort geleert.
    @State private var drafts: [String: String] = [:]
    @State private var setup: ProviderItem?

    init(client: ServiceClient, @ViewBuilder extras: () -> Extras) {
        _model = State(initialValue: ProvidersStore(client: client))
        self.extras = extras()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
            switch model.providers {
            case .idle, .loading:
                SettingsSkeleton(height: Theme.Metrics.pt56, radius: Theme.Radius.lg)
                    .accessibilityElement(children: .ignore).accessibilityLabel("Anbieter werden geladen")
            case .failed(let message, let offline):
                SettingsFailure(message: message, offline: offline) { Task { await model.load() } }
            case .loaded(let items):
                if items.isEmpty { SettingsHint(text: "Keine Anbieter verfügbar.") }
                LazyVGrid(columns: [GridItem(.flexible(), spacing: Theme.Metrics.pt12), GridItem(.flexible())], spacing: Theme.Metrics.pt12) {
                    ForEach(tiles(items)) { tile in card(tile.provider, tile: tile) }
                    extras
                }
            }
        }
        .task { if !staticRendering { await model.load() } }
        .sheet(item: $setup) { setupSheet($0) }
    }

    // Ein Dienst in der Galerie; mehrere Dienste (Gmail, Kalender) können über denselben Anbieter laufen.
    struct Tile: Identifiable {
        let id: String, title: String, text: String, logo: String?, provider: ProviderItem
    }

    private func tiles(_ items: [ProviderItem]) -> [Tile] {
        let services: [(String, String, String?, String)] = [
            ("Gmail", "E-Mails lesen und Entwürfe erstellen", "logo-gmail", "google"),
            ("Google Kalender", "Termine ansehen und planen", "logo-gcal", "google"),
            ("Outlook", "E-Mails und Kalender nutzen", "logo-outlook", "microsoft"),
            ("Spotify", "Musik steuern und entdecken", "logo-spotify", "spotify"),
            ("Nango", "Viele Dienste über einen Vermittler", "logo-nango", "nango"),
            ("Pipedream", "Viele Dienste über einen Vermittler", "logo-pipedream", "pipedream"),
        ]
        return services.compactMap { title, text, logo, id in
            items.first { $0.id == id }.map { Tile(id: title, title: title, text: text, logo: logo, provider: $0) }
        }
    }

    // Kachel wie im Figma-Marktplatz: Logo, Name, eine Zeile Text, Knopf „Verbinden“. Der Knopf öffnet die Anmeldeseite im Browser;
    // fehlen einmalige Zugangswerte, fragt zuerst ein Blatt danach.
    private func card(_ provider: ProviderItem, tile: Tile) -> some View {
        let busy = model.busy.contains(provider.id)
        return VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            HStack(spacing: Theme.Metrics.pt12) {
                MarketTileLogo {
                    if let logo = tile.logo { Image(logo).resizable().interpolation(.high).scaledToFit() }
                    else { Image(systemName: "point.3.connected.trianglepath.dotted").font(Theme.Fonts.title).foregroundStyle(Theme.Palette.mutedForeground) }
                }
                MarketTileText(title: tile.title, text: tile.text)
                Spacer(minLength: Theme.Metrics.pt8)
                if provider.connected {
                    MarketConnectedLabel { Task { await model.testRead(provider) } }
                        .disabled(busy)
                        .webContextMenu(screenName: "kontext-anbieter") {
                            [WebMenuItem(title: "Trennen", icon: "xmark.circle", destructive: true) {
                                confirm?(SettingsConfirm(title: "Dienst trennen?", message: "Zugang zu „\(tile.title)“ entfernen?", action: "Trennen") { await model.disconnect(provider) })
                            }]
                        }
                } else {
                    Button("Verbinden") {
                        if provider.configured { Task { await model.connect(provider) } } else { setup = provider }
                    }
                    .buttonStyle(MarketTileButtonStyle()).disabled(busy)
                }
            }
            if let error = model.errors[provider.id] { SettingsAlert(text: error) }
            if let result = model.results[provider.id] { SettingsHint(text: result, small: true) }
        }
        .marketTile()
    }

    // Einmalige Zugangswerte (Client-ID …) eintragen, speichern und gleich zur Anmeldung weitergehen.
    private func setupSheet(_ provider: ProviderItem) -> some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
            Text("\(provider.label) verbinden").font(Theme.Fonts.title)
            SettingsHint(text: provider.note.isEmpty ? "Für diesen Anbieter braucht Orbit einmalig deine eigenen Zugangswerte. Sie werden nur im Schlüsselbund gespeichert." : provider.note, small: true)
            ForEach(provider.setup, id: \.key) { field in
                let key = provider.id + "|" + field.key
                SecureField(field.label, text: Binding(get: { drafts[key] ?? "" }, set: { drafts[key] = $0 }))
                    .webInput().accessibilityLabel(field.label)
            }
            HStack(spacing: Theme.Metrics.pt8) {
                Spacer()
                Button("Abbrechen") { setup = nil }.buttonStyle(.card(.outline, small: true))
                Button("Weiter zur Anmeldung") {
                    let values = provider.setup.map { ($0.key, drafts[provider.id + "|" + $0.key] ?? "") }
                    for field in provider.setup { drafts[provider.id + "|" + field.key] = nil }
                    setup = nil
                    Task { await model.install(provider, values: values) }
                }
                .buttonStyle(.card(.secondary, small: true))
                .disabled(provider.setup.contains { (drafts[provider.id + "|" + $0.key] ?? "").isEmpty && !model.isSet(provider, key: $0.key) })
            }
        }
        .padding(Theme.Metrics.pt24)
        .frame(width: Theme.Metrics.pt400)
    }
}
