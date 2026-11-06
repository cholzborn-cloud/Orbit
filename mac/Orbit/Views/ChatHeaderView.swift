import SwiftUI

// Kopf (Figma 151:93975): Overlay über dem Verlauf, Pille mittig (41 hoch, voll gerundet,
// Innenabstand 6/20/6/10). Die Leiste selbst ist durchsichtig; Nachrichten bleiben darunter sichtbar.
struct ChatHeaderView<Avatar: View>: View {
    let title: String
    var state: OrbiState = .calm
    // „Pausiert, wartet bis 14:30 Uhr“ im Pausiert-Zustand (LimitStore).
    var limitText: String?
    @ViewBuilder let avatar: (CGFloat) -> Avatar
    // Klick klappt das rechte Panel auf und zu (Web: PANEL_TOGGLE_EVENT).
    let onPill: () -> Void
    @State private var pillHover = false
    @Environment(\.panelOpen) private var panelOpen
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // Figma Chat-Kopf (140:41502): Figur 28.
    private static var figure: CGFloat { Theme.Metrics.pt28 }

    var body: some View {
        Button(action: onPill) { pill }
            .buttonStyle(.plain)
            .probe("header-pill")
            .onHover { pillHover = $0 }
            .animation(Theme.Motion.hover.animation, value: pillHover)
            .frame(height: Theme.Layout.header)
            .animation(reduceMotion ? nil : Theme.Motion.panel.animation, value: panelOpen)
            .accessibilityLabel(title)
    }

    private var tooltip: String? {
        if state == .limit, let limitText { return "Pausiert, \(limitText)" }
        return state.statusDescription
    }

    // Glas wie orbitGlass(22): Blur, heller Schleier, feiner Rand (Web: bg-foreground/[0.06] ring-foreground/10 backdrop-blur-xl).
    private var pill: some View {
        HStack(spacing: Theme.Metrics.pt8) {
            avatar(Self.figure)
                .environment(\.headerHover, pillHover)
                .frame(width: Self.figure, height: Self.figure)
                .webTooltip(tooltip ?? "", edge: .bottom, enabled: tooltip != nil)
                .probe("header-avatar")
            // Figma: Name 13 Semi Bold; Hover (140:41514) Innenabstand rechts 10 mit chevron-right 10.
            Text(title).font(Theme.Fonts.geist(Theme.Fonts.size13, .semibold)).lineLimit(1).truncationMode(.tail)
            if pillHover { Image(systemName: "chevron.right").font(.system(size: Theme.Metrics.pt10, weight: .medium)).frame(width: Theme.Metrics.pt10).transition(.opacity) }
        }
        .foregroundStyle(Theme.Palette.foreground)
        .padding(.leading, Theme.Metrics.pt10).padding(.trailing, pillHover ? Theme.Metrics.pt10 : Theme.Metrics.pt20).padding(.vertical, Theme.Metrics.pt6)
        .frame(height: Theme.Layout.pill)
        .background(.ultraThinMaterial, in: .capsule)
        // Hover: foreground 6 % → 10 % (150 ms).
        .background(pillHover ? Theme.Palette.glassHover : Theme.Palette.glass, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))
        .contentShape(.capsule)
    }
}
