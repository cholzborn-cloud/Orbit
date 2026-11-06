import SwiftUI

// Gemeinsame Bausteine der Karten im Chat, nach shadcn-Vorlage (components/ui/button.tsx, badge.tsx, collapsible).

extension View {
    // Karte mit Rand und Fläche (Web: rounded-lg border bg-card), leuchtet beim Überfahren leicht auf.
    // Der Rand nimmt wie in CSS einen Punkt Platz ein (border-box + 1 px).
    func cardSurface(radius: CGFloat = Theme.Radius.lg, stroke: Color = Theme.Palette.border, fill: Color = Theme.Palette.card, line: CGFloat = 1) -> some View {
        modifier(CardSurface(radius: radius, stroke: stroke, fill: fill, line: line))
    }
}

private struct CardSurface: ViewModifier {
    let radius: CGFloat
    let stroke: Color
    let fill: Color
    var line: CGFloat = Theme.Metrics.pt1

    // Figma-Karten haben keinen Hover-Zustand (Consti 05.11.: wie Figma, kein Leuchten).
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(line)
            .background(fill, in: .rect(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(stroke, lineWidth: line))
    }
}

// Breite wie im Web: Karten sind `w-full max-w-md` in einer Spalte, die so breit ist wie ihr breitester Inhalt (WebColumn).
// Der eigene Beitrag zur Spaltenbreite ist min(Inhaltsbreite, max); in der Spalte füllt die Karte deren Breite, höchstens `max`.
private struct WebCardWidth: Layout {
    var maxWidth: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let view = subviews.first else { return .zero }
        guard let proposed = proposal.width else {
            return view.sizeThatFits(ProposedViewSize(width: min(view.sizeThatFits(.unspecified).width, maxWidth), height: nil))
        }
        return view.sizeThatFits(ProposedViewSize(width: min(maxWidth, proposed), height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}

extension View {
    func webCardWidth(max: CGFloat = Theme.Metrics.pt448) -> some View { WebCardWidth(maxWidth: max) { self } }
}

// Spalte einer Antwort (Web: flex-col gap-2 items-start): so breit wie das breiteste Kind, höchstens der angebotene Platz.
// Textblasen bleiben so breit wie ihr Text (w-fit), Karten füllen die Spalte (w-full).
struct WebColumn: Layout {
    var spacing: CGFloat = Theme.Metrics.pt8

    private func width(_ subviews: Subviews, _ proposal: ProposedViewSize) -> CGFloat {
        let ideal = subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
        return min(ideal, proposal.width ?? ideal)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = width(subviews, proposal)
        let heights = subviews.map { $0.sizeThatFits(ProposedViewSize(width: w, height: nil)).height }
        return CGSize(width: w, height: heights.reduce(0, +) + spacing * CGFloat(max(0, heights.count - 1)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let w = width(subviews, ProposedViewSize(width: bounds.width, height: nil))
        var y = bounds.minY
        for view in subviews {
            let size = view.sizeThatFits(ProposedViewSize(width: w, height: nil))
            view.place(at: CGPoint(x: bounds.minX, y: y), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: size.height))
            y += size.height + spacing
        }
    }
}

// Knopfsatz wie `buttonVariants` im Web (components/ui/button.tsx): Varianten, Größen, Hover (150 ms), gedrückt 1 pt tiefer,
// Fokusring 3 pt ring/50 % nur bei Tastaturfokus, deaktiviert 50 %.
struct CardButtonStyle: ButtonStyle {
    enum Variant { case primary, secondary, outline, destructive, ghost }
    enum Size {
        case regular, small, xs, large, icon, iconSmall, iconXS
        // Figma 1 Knöpfe (Antwort 2): alle Größen 24 hoch, Kapsel, Regular 12; quadratische Symbolknöpfe 24 × 24, r6 (6:13993, G4/G34).
        var height: CGFloat { Theme.Metrics.pt24 }
        var radius: CGFloat { square ? Theme.Radius.sm : Theme.Radius.full }
        var font: Font { Theme.Fonts.small }
        var square: Bool { self == .icon || self == .iconSmall || self == .iconXS }
    }
    var variant: Variant = .primary
    var size: Size = .regular
    // Menü-Auslöser (aria-haspopup) bewegen sich beim Drücken nicht.
    var opensMenu = false
    // Hover-Fläche erzwingen (offenes Menü: aria-expanded).
    var expanded = false

    func makeBody(configuration: Configuration) -> some View {
        WebButtonBody(configuration: configuration, style: self)
    }
}

private struct WebButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let style: CardButtonStyle
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled
    @Environment(\.isFocused) private var focused
    @Environment(\.colorScheme) private var scheme
    @Environment(\.webButtonFill) private var fill

    var body: some View {
        let size = style.size
        let shape = RoundedRectangle(cornerRadius: size.radius)
        configuration.label
            .font(size.font)
            .foregroundStyle(foreground)
            .padding(.horizontal, size.square ? Theme.Metrics.pt0 : Theme.Metrics.pt12)
            .frame(width: size.square ? size.height : nil, height: size.height)
            .frame(maxWidth: fill && !size.square ? .infinity : nil)
            .background(background, in: shape)
            .overlay {
                // Löschen: roter Umriss 0,5 (Antwort 2); outline hat keinen Rand mehr (= Zweit-Stil).
                if style.variant == .destructive { shape.strokeBorder(Theme.Palette.destructive, lineWidth: Theme.Metrics.pt0_5) }
                else if focused { shape.strokeBorder(outlineBorder, lineWidth: Theme.Metrics.pt1) }
            }
            .webFocusRing(focused, radius: size.radius)
            .contentShape(shape)
            .offset(y: configuration.isPressed && !style.opensMenu ? Theme.Motion.pressOffset : 0)
            .opacity(enabled ? 1 : (size.square ? Theme.Opacity.iconDisabled : Theme.Opacity.disabled))
            .focusEffectDisabled()
            .onHover { hover = $0 && enabled }
            .animation(Theme.Motion.hover.animation, value: hover)
            .animation(Theme.Motion.hover.animation, value: configuration.isPressed)
    }

    private var pressed: Bool { configuration.isPressed && !style.opensMenu }

    private var lit: Bool { hover || style.expanded }

    private var outlineBorder: Color { scheme == .dark ? Theme.Palette.input : Theme.Palette.border }

    private var foreground: Color {
        switch style.variant {
        case .primary: Theme.Palette.background
        case .secondary, .outline: style.size.square ? (lit ? Theme.Palette.foreground : Theme.Palette.mutedForeground) : Theme.Palette.secondaryForeground
        case .ghost: style.size.square ? (lit || pressed ? Theme.Palette.foreground : Theme.Palette.mutedForeground) : Theme.Palette.foreground
        case .destructive: Theme.Palette.destructive
        }
    }

    private var background: Color {
        switch style.variant {
        // Hauptknopf neutral, ohne Durchsichtigkeit bei Hover/gedrückt (G5).
        case .primary: return Theme.Palette.foreground
        // Zweit-Knopf (Figma 6:13662); outline sieht genauso aus (Antwort 2).
        case .secondary, .outline: return pressed ? Theme.Palette.input : (lit ? Theme.Palette.secondaryHover : Theme.Palette.secondary)
        // Löschen: Fläche card, Rand und Text destructive.
        case .destructive: return Theme.Palette.card
        // Icon-Knopf (Figma 6:13993): Hover secondaryHover, gedrückt input; nicht quadratisch: Hover secondaryHover.
        case .ghost: return pressed && style.size.square ? Theme.Palette.input : (lit ? Theme.Palette.secondaryHover : .clear)
        }
    }
}

extension EnvironmentValues {
    // Knopf füllt die angebotene Breite (Web: Knöpfe in grid-Zellen).
    @Entry var webButtonFill = false
}

extension ButtonStyle where Self == CardButtonStyle {
    static func card(_ variant: CardButtonStyle.Variant = .primary, small: Bool = false) -> CardButtonStyle { .init(variant: variant, size: small ? .small : .regular) }
    static func web(_ variant: CardButtonStyle.Variant = .primary, _ size: CardButtonStyle.Size = .regular, opensMenu: Bool = false, expanded: Bool = false) -> CardButtonStyle {
        .init(variant: variant, size: size, opensMenu: opensMenu, expanded: expanded)
    }
}

// Code-/JSON-Kasten (Web: CodeBlock in bg-muted/50). ImageRenderer zeichnet keine ScrollView: im Standbild steht der Text direkt.
struct CodeBox: View {
    let text: String
    var tint: Color = Theme.Palette.foreground
    var background: Color = Theme.Palette.muted.opacity(0.5)
    var maxHeight: CGFloat = Theme.Metrics.pt192
    @Environment(\.staticRendering) private var staticRendering

    private var label: some View {
        Text(text)
            .font(Theme.Fonts.mono(Theme.Metrics.pt12))
            .foregroundStyle(tint)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.pt8)
    }

    var body: some View {
        Group {
            if staticRendering {
                label.frame(maxHeight: maxHeight, alignment: .top).clipped()
            } else {
                ScrollView([.vertical, .horizontal]) { label }
                    .frame(maxHeight: maxHeight)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .background(background, in: .rect(cornerRadius: Theme.Radius.md))
    }
}

// Aufklappbare Kopfzeile mit Drehpfeil (Web: Collapsible + ChevronDown).
struct ChevronMark: View {
    let open: Bool
    var body: some View {
        Image(systemName: "chevron.down")
            .font(Theme.Fonts.geist(Theme.Metrics.pt12, .medium))
            .foregroundStyle(Theme.Palette.mutedForeground)
            .rotationEffect(.degrees(open ? 0 : -90))
    }
}

// Einheitliche Hinweiszeile im Fehlerton, z. B. unter einer Karte.
struct InlineAlert: View {
    let text: String
    var body: some View {
        Text(text).font(Theme.Fonts.geist(Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.destructive)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isStaticText)
    }
}

// Für ImageRenderer: Eingabefelder und Menüs zeichnet er nicht; dort gelten Ersatzansichten.
private struct StaticRenderingKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var staticRendering: Bool {
        get { self[StaticRenderingKey.self] }
        set { self[StaticRenderingKey.self] = newValue }
    }
}


// Kleiner runder Knopf der Karten nach Figma (7.1 „Grundteile Knopf“: 24 hoch, Pille, innen 12, Regular 12):
// `solid` = Farbe des Orbis (Einmal erlauben, Weiter), `tint` = hell getönt (Immer erlauben), `outline` = Rand 0,5 (Ablehnen, Überspringen).
struct PillButtonStyle: ButtonStyle {
    // bordered = Zweit-Knopf auf Karten (Figma 04/teil-1 „Ablehnen“, teil-2 „Überspringen“): Kartenfläche mit Rand border 0,5.
    enum Variant { case solid, tint, outline, bordered }
    var variant: Variant = .solid
    var neutral = false
    @Environment(\.isEnabled) private var enabled
    @State private var hover = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Fonts.small)
            .foregroundStyle(foreground)
            .padding(.horizontal, Theme.Metrics.pt12).frame(height: Theme.Metrics.pt24)
            .background(background(pressed: configuration.isPressed), in: Capsule())
            .overlay { if variant == .bordered { Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) } }
            .contentShape(Capsule())
            .opacity(enabled ? 1 : Theme.Opacity.disabled)
            .onHover { hover = $0 && enabled }
            .animation(Theme.Motion.hover.animation, value: hover)
    }

    // Figma Freigabe (145:58673): „Immer erlauben“ Text foreground auf Primärfarbe 16 %.
    private var foreground: Color {
        switch variant {
        case .solid: neutral ? Theme.Palette.background : Theme.Palette.primaryForeground
        case .tint: Theme.Palette.foreground
        case .outline, .bordered: Theme.Palette.foreground
        }
    }

    // Hover/gedrückt ohne Durchsichtigkeit (G5); outline = Zweit-Stil (Antwort 2).
    private func background(pressed: Bool) -> Color {
        switch variant {
        case .solid: neutral ? Theme.Palette.foreground : Theme.Palette.primary
        case .tint: neutral ? Theme.Palette.accentNeutral : Theme.Palette.primary.opacity(0.16)
        case .outline: pressed ? Theme.Palette.input : (hover ? Theme.Palette.secondaryRaisedHover : Theme.Palette.secondaryRaised)
        case .bordered: pressed ? Theme.Palette.input : (hover ? Theme.Palette.secondaryRaisedHover : Theme.Palette.card)
        }
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    static func pill(_ variant: PillButtonStyle.Variant = .solid, neutral: Bool = false) -> PillButtonStyle { .init(variant: variant, neutral: neutral) }
}
