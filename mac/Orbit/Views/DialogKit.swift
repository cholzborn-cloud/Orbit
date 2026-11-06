import SwiftUI

// Dialog wie components/ui/dialog.tsx: popover-Fläche, Radius 14, Rand foreground/10, Kopf (Titel 16/500, Beschreibung 14 muted),
// Inhalt mit Abstand 16, Fuß als volle Leiste (muted/50, Linie oben) mit Knöpfen rechts.
struct DialogShell<Content: View, Footer: View>: View {
    let title: String
    let description: String
    var width: CGFloat = Theme.Metrics.pt448
    var height: CGFloat?
    let onClose: () -> Void
    @ViewBuilder let content: Content
    @ViewBuilder let footer: Footer
    @State private var overlay = OverlayCenter()

    var body: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
                Text(title).font(Theme.Fonts.geist(Theme.Fonts.size16, .medium)).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.popoverForeground)
                Text(description).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // Figma Dialog-Kopf (140:42639): innen 16/44/20/16.
            .padding(.leading, Theme.Metrics.pt16).padding(.trailing, Theme.Metrics.pt44).padding(.top, Theme.Metrics.pt16).padding(.bottom, Theme.Metrics.pt20)
            .overlay(alignment: .topTrailing) {
                // Web: DialogClose als Button ghost icon-sm (28, r 8, Hover muted 50 %).
                Button(action: onClose) { Image(systemName: "xmark").font(.system(size: Theme.Metrics.pt14)) }
                    .buttonStyle(.web(.ghost, .iconSmall)).padding(Theme.Metrics.pt8).accessibilityLabel("Schließen")
            }
            ScrollView { content.padding(.horizontal, Theme.Metrics.pt16).padding(.bottom, Theme.Metrics.pt16) }
            // Ohne Fuß (EmptyView) keine Leiste, wie ein Dialog ohne DialogFooter.
            if Footer.self != EmptyView.self {
                HStack(spacing: Theme.Metrics.pt8) { footer }
                    .padding(Theme.Metrics.pt16)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    // Figma Dialog-Fuß (140:42646): muted voll, Linie oben 0,5.
                    .background(Theme.Palette.muted)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
            }
        }
        .frame(width: width)
        .frame(maxHeight: height ?? .infinity)
        // Figma Dialog (140:42638): Fläche card, r16, Ring 0,5.
        .background(Theme.Palette.card)
        .clipShape(.rect(cornerRadius: Theme.Metrics.pt16))
        .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt16).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))
        .foregroundStyle(Theme.Palette.popoverForeground)
        .font(Theme.Fonts.body)
        // Sheets haben einen eigenen Fensterraum; Menüs dürfen kein Overlay des Elternfensters erben.
        .overlay { OverlayLayer(center: overlay) }
        .coordinateSpace(name: "orbit-window")
        .environment(\.overlay, overlay)
    }
}

// Feld mit Beschriftung (Web: Field + FieldLabel): 14 medium, Abstand 8.
struct DialogField<Content: View>: View {
    let label: String?
    @ViewBuilder let content: Content

    init(_ label: String? = nil, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            if let label { Text(label).font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt19_25)) }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    // Eingabefeld nach Figma „Grundteile Eingabefeld“ (6:13745): 24 hoch (mehrzeilig frei), Innenabstand 12, Radius 12,
    // Regular 12, Fläche secondary (Hover/Fokus secondaryHover), kein Rand; deaktiviert 40 %; `error` = Rand destructive 1 + Text 10 darunter.
    func webInput(multiline: Bool = false, error: String? = nil) -> some View { modifier(WebInput(multiline: multiline, error: error)) }
}

private struct WebInput: ViewModifier {
    let multiline: Bool
    let error: String?
    @FocusState private var focused: Bool
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt4) {
            content.textFieldStyle(.plain)
                .font(Theme.Fonts.small)
                .focused($focused)
                .focusEffectDisabled()
                .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, multiline ? Theme.Metrics.pt8 : Theme.Metrics.pt0)
                .frame(minHeight: multiline ? Theme.Metrics.pt0 : Theme.Metrics.pt24)
                .background(hover || focused ? Theme.Palette.secondaryHover : Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Radius.field))
                .overlay { if error != nil { RoundedRectangle(cornerRadius: Theme.Radius.field).strokeBorder(Theme.Palette.destructive, lineWidth: Theme.Metrics.pt1) } }
                .webFocusRing(focused, radius: Theme.Radius.field)
                .opacity(enabled ? 1 : Theme.Opacity.disabled)
                .onHover { hover = $0 && enabled }
                .animation(Theme.Motion.hover.animation, value: focused)
                .animation(Theme.Motion.hover.animation, value: hover)
            if let error { Text(error).font(Theme.Fonts.geist(Theme.Metrics.pt10)).foregroundStyle(Theme.Palette.destructive) }
        }
    }
}

// Reiter nach Figma „Grundteile Reiter“ (6:13873): Leiste 26 hoch (Innenabstand 2, Reiter 22), Fläche secondary, Rand border 0,5;
// aktiver Reiter segmentThumb, Medium 12 foreground; inaktiv Regular 12 mutedForeground.
struct WebTabs<Tab: Hashable & Identifiable>: View {
    let tabs: [Tab]
    @Binding var selection: Tab
    let title: (Tab) -> String
    @Namespace private var space
    @State private var hovered: Tab.ID?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: Theme.Metrics.pt0) {
            ForEach(tabs) { tab in
                let active = selection == tab
                let lit = hovered == tab.id
                Button { selection = tab } label: {
                    Text(title(tab)).font(active ? Theme.Fonts.smallMedium : Theme.Fonts.small)
                        .foregroundStyle(active || lit ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                        .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt22)
                        .background {
                            // Hover (G29): inaktiv secondaryHover; aktive Markierung gleitet (matchedGeometry, Theme.Motion.tab).
                            if active { Capsule().fill(Theme.Palette.segmentThumb).matchedGeometryEffect(id: "mark", in: space) }
                            else if lit { Capsule().fill(Theme.Palette.secondaryHover) }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .onHover { hovered = $0 ? tab.id : (hovered == tab.id ? nil : hovered) }
                .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(Theme.Metrics.pt2)
        .background(Theme.Palette.secondary, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
        .animation(reduceMotion ? nil : Theme.Motion.tab.animation, value: selection)
        .animation(Theme.Motion.hover.animation, value: hovered)
    }
}

// Bestätigung wie AlertDialog (components/ui/alert-dialog.tsx): 384 breit, r 14, Ring 10 %, Innenabstand 16; Titel 16/24 500,
// Text 14/20 muted (Abstand 6); Fuß über die volle Breite (muted 50 %, Linie oben) mit Abbrechen (Umriss) und Aktion (destruktiv).
struct AlertDialogView: View {
    let title: String
    let message: String
    let action: String
    var error: String?
    var busy = false
    let onCancel: () -> Void
    let onConfirm: () -> Void
    // Web: der Dialog fokussiert beim Öffnen „Abbrechen“ (mit sichtbarem Fokusring).
    @FocusState private var cancelFocused: Bool

    var body: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            // Figma Dialog Löschen (141:48345): innen 16/16/20/16, Abstand 8, Titel 16 Medium/20.
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Text(title).font(Theme.Fonts.geist(Theme.Fonts.size16, .medium)).lineHeight(.exact(points: Theme.Metrics.pt20))
                Text(message).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                if let error { InlineAlert(text: error).padding(.top, Theme.Metrics.pt6) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.top, .horizontal], Theme.Metrics.pt16).padding(.bottom, Theme.Metrics.pt20)
            HStack(spacing: Theme.Metrics.pt8) {
                Spacer(minLength: Theme.Metrics.pt0)
                Button("Abbrechen", action: onCancel).buttonStyle(.card(.outline)).keyboardShortcut(.cancelAction).disabled(busy)
                    .focused($cancelFocused)
                Button(busy ? (action.localizedCaseInsensitiveContains("löschen") || action == "Leeren" ? "Löscht …" : "Läuft …") : action, action: onConfirm)
                    .buttonStyle(.card(.destructive)).keyboardShortcut(.defaultAction).disabled(busy)
            }
            .padding(Theme.Metrics.pt16)
            .background(Theme.Palette.muted)
            .overlay(alignment: .top) { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
        }
        .frame(width: Theme.Metrics.pt384)
        .background(Theme.Palette.card)
        .clipShape(.rect(cornerRadius: Theme.Metrics.pt16))
        .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt16).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))
        .foregroundStyle(Theme.Palette.popoverForeground)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .onAppear { cancelFocused = true }
    }
}

// Ebene für Dialoge wie im Web: Hintergrund schwarz 10 % mit Unschärfe, Dialog mittig; auf/zu 100 ms ease mit Zoom von 95 %.
// Klick daneben schließt (Base UI Dialog), Esc über die Abbrechen-Taste des Dialogs.
struct DialogLayer<Content: View>: View {
    let visible: Bool
    let onDismiss: () -> Void
    @ViewBuilder let content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if visible {
                Theme.Palette.scrim
                    .contentShape(.rect)
                    .onTapGesture(perform: onDismiss)
                    .transition(.opacity)
                // Web: max-w calc(100% - 2rem): 16 pt Rand zum Fenster.
                content
                    .padding(Theme.Metrics.pt16)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.95).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(Theme.Motion.pop.animation, value: visible)
    }
}
