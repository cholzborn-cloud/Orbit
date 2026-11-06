import SwiftUI

// Baukasten der Einstellungen (neu 06.11.2026), Aufbau wie die macOS-Systemeinstellungen:
// Seite mit Titel, darunter Gruppen. Gruppe = eine Fläche `card` (r10, Rand 0,5), Zeilen durch Linien getrennt.
// Zeile = Name links (darunter höchstens ein kurzer Satz), rechts Wert oder Bedienelement.

struct FormPage<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Layout.settingsGroupGap) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt4) {
                Text(title).font(Theme.Fonts.settingsTitle).accessibilityAddTraits(.isHeader)
                if let subtitle { Text(subtitle).font(Theme.Fonts.subhead).foregroundStyle(Theme.Palette.mutedForeground) }
            }
            content
        }
        .frame(maxWidth: Theme.Layout.settingsContent, alignment: .leading)
        .frame(maxWidth: .infinity)
    }
}

struct FormSection<Content: View>: View {
    var title: String?
    var footer: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt6) {
            if let title {
                Text(title).font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.mutedForeground)
                    .padding(.leading, Theme.Metrics.pt12).accessibilityAddTraits(.isHeader)
            }
            VStack(spacing: Theme.Metrics.pt0) {
                Group(subviews: content) { rows in
                    ForEach(rows.indices, id: \.self) { index in
                        if index > 0 { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5).padding(.leading, Theme.Metrics.pt12) }
                        rows[index]
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .clipShape(.rect(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            if let footer {
                Text(footer).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                    .padding(.horizontal, Theme.Metrics.pt12).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct FormRow<Trailing: View>: View {
    let title: String
    var detail: String?
    var symbol: String?
    var tint: Color?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: Theme.Metrics.pt10) {
            if let symbol {
                Image(systemName: symbol).font(.system(size: Theme.Metrics.pt14)).foregroundStyle(tint ?? Theme.Palette.foreground)
                    .frame(width: Theme.Metrics.pt18).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                Text(title).font(Theme.Fonts.body)
                if let detail, !detail.isEmpty {
                    Text(detail).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt8)
        .frame(minHeight: Theme.Layout.settingsRow)
        .accessibilityElement(children: .contain)
    }
}

extension FormRow where Trailing == EmptyView {
    init(title: String, detail: String? = nil, symbol: String? = nil, tint: Color? = nil) {
        self.init(title: title, detail: detail, symbol: symbol, tint: tint) { EmptyView() }
    }
}

// Wert rechts in einer Zeile (aktueller Zustand, nicht klickbar).
struct FormValue: View {
    let text: String
    var dot: Color?
    var body: some View {
        HStack(spacing: Theme.Metrics.pt6) {
            if let dot { Circle().fill(dot).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6).accessibilityHidden(true) }
            Text(text).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground)
        }
        .fixedSize()
    }
}

// Freier Inhalt in einer Gruppe (Editor, Formular), mit dem Innenrand der Zeilen.
struct FormBlock<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt10) { content }
            .padding(Theme.Metrics.pt12).frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Ladezustand, Fehler mit „Erneut versuchen“ und Leerzustand als normale Zeilen einer Gruppe.
struct FormLoadRow: View {
    var text = "Lädt …"
    var body: some View {
        FormRow(title: text) { Spinner() }.accessibilityLabel(text)
    }
}

struct FormFailureRow: View {
    let message: String
    var offline = false
    let retry: () -> Void
    var body: some View {
        FormRow(title: offline ? "Orbit-Dienst nicht erreichbar" : "Konnte nicht geladen werden", detail: message,
                symbol: "exclamationmark.triangle", tint: Theme.Palette.destructive) {
            Button("Erneut versuchen", action: retry).buttonStyle(.card(.outline, small: true))
        }
    }
}

extension View {
    // Eingabefeld in einer Gruppe: Feldfläche gleicht im Dunkeln der Gruppe (#1f1f1f), der Rand macht es erkennbar.
    func formField() -> some View {
        overlay(RoundedRectangle(cornerRadius: Theme.Radius.field).strokeBorder(Theme.Palette.input, lineWidth: Theme.Metrics.pt0_5).allowsHitTesting(false))
    }
}
