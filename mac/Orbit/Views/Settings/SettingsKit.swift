import SwiftUI

// Bausteine der Einstellungen nach shadcn (Alert, Badge, Card, Progress, Skeleton). Werte aus den Web-Klassen:
// Alert rounded-lg border px-2.5 py-2 text-sm; Badge h-5 px-2 text-xs; Card size sm rounded-xl ring-1 py-3 gap-3; Progress h-1.

struct SettingsTitle: View {
    let text: String
    var body: some View {
        Text(text).font(Theme.Fonts.geist(Theme.Fonts.size16, .medium)).lineHeight(.exact(points: Theme.Metrics.pt24)).accessibilityAddTraits(.isHeader)
    }
}

// Abschnittsname innerhalb einer Seite (Figma, P37): 11 Medium muted.
struct SettingsSectionTitle: View {
    let text: String
    var body: some View {
        Text(text).font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.mutedForeground).accessibilityAddTraits(.isHeader)
    }
}

// Gruppierte Liste (Figma, P35): eine Box card r10, Rand 0,5, Trenner 0,5; Zeilen 40, innen 0/12.
struct SettingsGroup<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(spacing: Theme.Metrics.pt0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .clipShape(.rect(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }
}

struct SettingsGroupDivider: View {
    var body: some View { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
}

// Zeile in der Gruppe: Name 12, Zusatz 11 muted, ⋯ bei Hover (24, r6, Symbol 14) mit den Aktionen.
struct SettingsGroupRow: View {
    let title: String
    var detail: String?
    var tip: String?
    let actions: () -> [WebMenuItem]
    @State private var hover = false

    var body: some View {
        HStack(spacing: Theme.Metrics.pt10) {
            Text(title).font(Theme.Fonts.small).lineLimit(1).truncationMode(.middle).layoutPriority(1)
            if let detail, !detail.isEmpty {
                Text(detail).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
            }
            Spacer(minLength: Theme.Metrics.pt0)
            WebMenuButton(alignment: .trailing, items: actions) { open in
                Image(systemName: "ellipsis").font(.system(size: Theme.Metrics.pt14))
                    .foregroundStyle(hover || open ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                    .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
                    .contentShape(.rect(cornerRadius: Theme.Radius.sm))
            }
            .opacity(hover ? 1 : 0)
            .accessibilityLabel("Aktionen für \(title)")
        }
        .padding(.horizontal, Theme.Metrics.pt12).frame(height: Theme.Metrics.pt40)
        .background(hover ? Theme.Palette.secondaryHover : .clear)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: hover)
    }
}

struct SettingsHint: View {
    let text: String
    var small = false
    var body: some View {
        Text(text).font(small ? Theme.Fonts.small : Theme.Fonts.body)
            .lineHeight(.exact(points: small ? 16 : 20))
            .foregroundStyle(Theme.Palette.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Alert variant destructive: Symbol 16, Text im Fehlerton.
struct SettingsAlert: View {
    var title: String?
    let text: String
    var symbol = "exclamationmark.triangle"

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Metrics.pt8) {
            Image(systemName: symbol).font(.system(size: Theme.Metrics.pt14)).frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt2)
            VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                if let title { Text(title).font(Theme.Fonts.bodyMedium) }
                Text(text).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(Theme.Palette.destructive)
        .padding(.horizontal, Theme.Metrics.pt10).padding(.vertical, Theme.Metrics.pt8)
        .padding(Theme.Metrics.pt1)
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

// Offline-Hinweis (Dienst nicht erreichbar) mit „Erneut laden“.
struct SettingsFailure: View {
    let message: String
    var offline = false
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            SettingsAlert(title: offline ? "Dienst nicht erreichbar" : "Konnte nicht geladen werden", text: message,
                          symbol: offline ? "wifi.slash" : "exclamationmark.triangle")
            Button("Erneut laden", action: retry).buttonStyle(.card(.outline, small: true))
        }
    }
}

struct SettingsBadge: View {
    enum Tone { case primary, secondary, destructive, outline }
    let text: String
    var tone: Tone = .secondary
    // Kleines Drehzeichen vor dem Text (Web: <Spinner /> im Badge „Läuft“).
    var spinning = false

    // Figma „Grundteile Tag“ (6:13962): Pille 20, innen 0/8, Abstand 5, Punkt 6, Regular 11 foreground, Fläche immer secondary.
    // Punkt: Akzent foreground, Neutral mutedForeground, Fehler status/danger.
    var body: some View {
        HStack(spacing: Theme.Metrics.pt5) {
            if spinning { Spinner(size: Theme.Metrics.pt6) }
            else { Circle().fill(dot).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6) }
            Text(text).font(Theme.Fonts.caption).lineLimit(1)
        }
            .foregroundStyle(Theme.Palette.foreground)
            .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt20)
            .background(Theme.Palette.secondary, in: .capsule)
    }

    private var dot: Color {
        switch tone {
        case .primary: Theme.Palette.foreground
        case .secondary, .outline: Theme.Palette.mutedForeground
        case .destructive: Theme.Status.danger
        }
    }
}

// Bereich mit Rand (Web: rounded-lg border p-3).
struct SettingsBox<Content: View>: View {
    var padding: CGFloat = Theme.Metrics.pt12
    @ViewBuilder let content: Content
    var body: some View {
        // Figma Einstellungen-Box (143:54088): Fläche card, Rand border 0,5, innen 10/12, r10.
        content.padding(.horizontal, padding).padding(.vertical, padding == Theme.Metrics.pt12 ? Theme.Metrics.pt10 : padding).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }
}

// Karte (Web: Card size sm): rounded-xl, Ring foreground/10, Fläche card, Innenabstand 12, Abstand 12.
struct SettingsCard<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt12) { content }
            .padding(Theme.Metrics.pt12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.xl))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xl).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt1))
    }
}

// Fortschritt (Web: Progress): Spur 4 hoch muted, Füllung primary, ab 80 % im Fehlerton.
struct SettingsProgress: View {
    let label: String
    let percent: Int
    static let warnAt = 80

    var body: some View {
        VStack(spacing: Theme.Metrics.pt8) {
            HStack {
                Text(label).font(Theme.Fonts.bodyMedium)
                Spacer()
                Text("\(percent) %").font(Theme.Fonts.body).monospacedDigit().foregroundStyle(Theme.Palette.mutedForeground)
            }
            .frame(height: Theme.Metrics.pt20)
            Capsule().fill(Theme.Palette.muted).frame(height: Theme.Metrics.pt4)
                .overlay(alignment: .leading) {
                    GeometryReader { proxy in
                        Capsule().fill(percent >= Self.warnAt ? Theme.Palette.destructive : Theme.Palette.primary)
                            .frame(width: proxy.size.width * CGFloat(percent) / 100)
                    }
                }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue("\(percent) Prozent")
    }
}

// Platzhalter beim Laden (Web: Skeleton, animate-pulse).
struct SettingsSkeleton: View {
    var height: CGFloat = Theme.Metrics.pt32
    var radius: CGFloat = Theme.Radius.md
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RoundedRectangle(cornerRadius: radius).fill(Theme.Palette.muted)
            .frame(height: height).opacity(dim ? 0.5 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: Theme.Motion.skeletonDuration).repeatForever(autoreverses: true)) { dim = true }
            }
            .accessibilityHidden(true)
    }
}

// Mehrzeiliges Feld wie Textarea (Rand input, Fläche field, Radius 10), mit Platzhalter.
struct SettingsTextArea: View {
    @Binding var text: String
    var minHeight: CGFloat = Theme.Metrics.pt62
    var placeholder = ""
    var mono = false
    var label: String

    var body: some View {
        TextEditor(text: $text)
            .font(mono ? Theme.Fonts.mono(Theme.Fonts.size13) : Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt20)).scrollContentBackground(.hidden)   // Figma 143:54931: 13/20
            .frame(minHeight: minHeight)
            // K57: Innenabstand 10/12 (TextEditor bringt rund 5 pt seitlich selbst mit).
            .padding(.horizontal, Theme.Metrics.pt7).padding(.vertical, Theme.Metrics.pt10)
            .overlay(alignment: .topLeading) {
                if text.isEmpty && !placeholder.isEmpty {
                    Text(placeholder).font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
                        .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt10).allowsHitTesting(false)
                }
            }
            // Figma „Orbis-Anleitung“: graue Fläche ohne Rand.
            .background(Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Radius.lg))
            .accessibilityLabel(label)
    }
}

// Zeile mit Schalter (Web: label flex justify-between rounded-lg border p-3).
struct SettingsSwitchRow: View {
    let label: String
    let detail: String
    @Binding var isOn: Bool
    var disabled = false

    var body: some View {
        SettingsBox {
            HStack(alignment: .top, spacing: Theme.Metrics.pt16) {
                VStack(alignment: .leading, spacing: Theme.Metrics.pt4) {
                    Text(label).font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt20))
                    Text(detail).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Toggle(label, isOn: $isOn).toggleStyle(WebSwitchStyle()).labelsHidden().disabled(disabled)
            }
        }
        .contentShape(.rect)
        .onTapGesture { if !disabled { isOn.toggle() } }
    }
}

// Bestätigung vor dem Löschen (Web: window.confirm), als Dialog im Einstellungsfenster.
struct SettingsConfirm: Equatable, Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let action: String
    let perform: @MainActor @Sendable () async -> Void

    static func == (lhs: SettingsConfirm, rhs: SettingsConfirm) -> Bool { lhs.id == rhs.id }
}


// Drehzeichen (Web: Spinner = Loader2, animate-spin): ein Dreiviertelkreis, eine Umdrehung pro Sekunde.
struct Spinner: View {
    var size: CGFloat = Theme.Metrics.pt16
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.ambient(paused: reduceMotion)) { context in
            Circle().trim(from: 0, to: 0.75).stroke(style: StrokeStyle(lineWidth: size / 8, lineCap: .round))
                .frame(width: size - size / 8, height: size - size / 8)
                .rotationEffect(.degrees(reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Theme.Metrics.pt1) * 360))
                .frame(width: size, height: size)
        }
        .accessibilityLabel("Läuft")
    }
}
