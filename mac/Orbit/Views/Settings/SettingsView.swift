import SwiftUI

// Löschen und Zurücknehmen im Einstellungsfenster fragen über einen Dialog nach.
struct ConfirmAsk {
    let run: (SettingsConfirm) -> Void
    func callAsFunction(_ item: SettingsConfirm) { run(item) }
}

extension EnvironmentValues {
    @Entry var settingsConfirm: ConfirmAsk?
}

// Einstellungen als eigenes Fenster (Cmd+,), neu am 06.11.2026 (alte Fassung: mac/Archiv/Einstellungen-alt-2026-11-06):
// links fünf Bereiche nach Nutzerziel, rechts die Seite mit gruppierten Zeilen wie in den macOS-Systemeinstellungen.
struct SettingsView: View {
    @Environment(\.staticRendering) private var staticRendering
    let store: SettingsStore
    @State private var overlay = OverlayCenter()
    @State private var confirm: SettingsConfirm?
    @State private var confirmBusy = false
    // Zuletzt geöffneter Bereich (Apple HIG): beim ersten Öffnen nach dem Start wiederherstellen, sofern niemand gezielt woandershin wollte.
    @AppStorage("settings.section") private var lastSection = SettingsSection.setup.rawValue
    @MainActor private static var restored = false
    // Screenshot-Modus: Bereich weder wiederherstellen noch merken (keine Einstellungen der echten App anfassen).
    @MainActor static var remembersSection = true

    // Breit genug für die Kacheln im Marktplatz (Consti, 05.11.2026).
    static let size = CGSize(width: Theme.Metrics.pt1120, height: Theme.Metrics.pt760)

    // Reihenfolge der Seitenleiste: Häufiges oben, Nutzung zuletzt. Skills, Konnektoren und Freigaben liegen in ihren Bereichen.
    static let pages: [SettingsSection] = [.setup, .appearance, .orbis, .marketplace, .usage]

    static func symbol(_ section: SettingsSection) -> String {
        switch section {
        case .orbis, .skills: "person.2"
        default: section.symbol
        }
    }

    var body: some View {
        let modal = store.editingConnector != nil || confirm != nil
        HStack(spacing: Theme.Metrics.pt0) {
            nav
            Rectangle().fill(Theme.Palette.border).frame(width: Theme.Metrics.pt0_5)
            ScrollView {
                page
                    .padding(.horizontal, Theme.Layout.settingsPadding).padding(.vertical, Theme.Metrics.pt28)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.never)
            .id(store.section)
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .background(Theme.Palette.background)
        .background(CenteredWindow())
        .foregroundStyle(Theme.Palette.foreground)
        .font(Theme.Fonts.body)
        .blur(radius: modal ? Theme.Spacing.xs : Theme.Metrics.pt0)
        .overlay { dialogs }
        .coordinateSpace(name: "orbit-window")
        .overlay { OverlayLayer(center: overlay) }
        .environment(\.overlay, overlay)
        .environment(\.settingsConfirm, ConfirmAsk { confirm = $0 })
        .onAppear {
            guard !staticRendering, Self.remembersSection, !Self.restored else { return }
            Self.restored = true
            if store.section == .setup, let saved = SettingsSection(rawValue: lastSection) { store.section = saved }
        }
        .onChange(of: store.section) { _, section in if !staticRendering, Self.remembersSection { lastSection = section.rawValue } }
        .task(id: store.section) { if !staticRendering { await store.load(store.section) } }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in if !staticRendering { Task { await store.appBecameActive() } } }
    }

    // Seitenleiste: Eintrag 32 hoch, Abstand 2, Rand 12 (die Klickprobe der Design-Abnahme rechnet damit).
    private var nav: some View {
        VStack(spacing: Theme.Metrics.pt2) {
            ForEach(Self.pages) { section in
                SettingsNavItem(title: section.title, symbol: Self.symbol(section), active: store.section == section) { store.section = section }
            }
            Spacer(minLength: Theme.Metrics.pt0)
        }
        .padding(Theme.Metrics.pt12)
        .frame(width: Theme.Layout.settingsSidebar)
        .background(Theme.Palette.sidebar)
    }

    @ViewBuilder private var page: some View {
        switch store.section {
        case .setup, .approvals: SettingsGeneralPage(store: store)
        case .appearance: SettingsAppearancePage(store: store)
        case .orbis, .skills: SettingsOrbisPage(store: store)
        case .marketplace, .connectors: SettingsMarketplaceView(store: store)
        case .usage:
            VStack(alignment: .leading, spacing: Theme.Layout.settingsGroupGap) {
                SettingsUsageView(store: store)
                SettingsBudgetSection(setup: store.setup, botNames: store.botNames)
            }
            .frame(maxWidth: Theme.Layout.settingsContent, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private var dialogs: some View {
        ZStack {
            DialogLayer(visible: store.editingConnector != nil, onDismiss: { store.editingConnector = nil }) {
                if let id = store.editingConnector, let connector = store.connectors.value?.first(where: { $0.id == id }) {
                    ConnectorEditView(store: store, connector: connector, onClose: { store.editingConnector = nil })
                }
            }
            DialogLayer(visible: confirm != nil, onDismiss: { if !confirmBusy { confirm = nil } }) {
                if let item = confirm {
                    AlertDialogView(title: item.title, message: item.message, action: item.action, busy: confirmBusy, onCancel: { confirm = nil }) {
                        confirmBusy = true
                        Task { await item.perform(); confirmBusy = false; confirm = nil }
                    }
                }
            }
        }
    }
}

// Eintrag der Seitenleiste: Symbol und Name; gewählt mit Fläche, Hover heller.
private struct SettingsNavItem: View {
    let title: String
    let symbol: String
    let active: Bool
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Metrics.pt8) {
                Image(systemName: symbol).font(.system(size: Theme.Metrics.pt14)).frame(width: Theme.Metrics.pt18)
                    .foregroundStyle(active ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                Text(title).font(active ? Theme.Fonts.bodyMedium : Theme.Fonts.body).lineLimit(1)
                Spacer(minLength: Theme.Metrics.pt0)
            }
            .padding(.horizontal, Theme.Metrics.pt10).frame(height: Theme.Layout.settingsNavRow)
            .foregroundStyle(Theme.Palette.foreground)
            .background(active ? Theme.Palette.secondaryHover : hover ? Theme.Palette.glassHover : .clear, in: .rect(cornerRadius: Theme.Radius.md))
            .contentShape(.rect(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: hover)
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}

// Das Einstellungsfenster steht beim Öffnen mittig auf dem Bildschirm und lässt sich nicht verschieben.
private struct CenteredWindow: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            window.center()
            window.isMovable = false
        }
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {}
}
