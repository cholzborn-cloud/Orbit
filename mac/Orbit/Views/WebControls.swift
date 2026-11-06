import AppKit
import SwiftUI

// Steuerelemente im Stil der Web-UI (components/ui/*): Schalter, Kästchen, Regler, Segment, Auswahl, Menüs, Tooltips.
// Menüs und Tooltips liegen in einer Ebene über dem Fenster (OverlayLayer), damit sie wie im Web aussehen und animieren.

extension View {
    // Früher Fokusring wie focus-visible; jetzt bewusst ohne.
    func webFocusRing(_ on: Bool, radius: CGFloat) -> some View {
        self   // Kein Leuchtring um fokussierte Felder (Consti, 27.10.2026)
    }
}

// Schalter nach Figma (6:13764): 30 × 18, Knopf 14; Größe small und Fokusring entfernt (G26).
struct WebSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View { WebSwitch(configuration: configuration) }
}

private struct WebSwitch: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.isEnabled) private var enabled
    @Environment(\.colorScheme) private var scheme
    @State private var hover = false

    var body: some View {
        let on = configuration.isOn
        let dark = scheme == .dark
        Button { configuration.isOn.toggle() } label: {
            // Bahn 30 × 18, Innenabstand 2; aus track, an foreground; Knopf thumb, im Dunkelmodus bei „an“ background.
            // Hover bei „an“ (G25): Überlagerung thumb 15 % (dunkel background 12 %); bei „aus“ unverändert.
            Capsule()
                .fill(on ? Theme.Palette.foreground : Theme.Palette.track)
                .overlay { Capsule().fill(dark ? Theme.Palette.background.opacity(0.12) : Theme.Palette.thumb.opacity(0.15)).opacity(on && hover && enabled ? 1 : 0) }
                .frame(width: Theme.Metrics.pt30, height: Theme.Metrics.pt18)
                .overlay(alignment: .leading) {
                    Circle()
                        .fill(on && dark ? Theme.Palette.background : Theme.Palette.thumb)
                        .frame(width: Theme.Metrics.pt14, height: Theme.Metrics.pt14)
                        .offset(x: on ? Theme.Metrics.pt14 : Theme.Metrics.pt2)
                }
                .contentShape(.rect.inset(by: -Theme.Metrics.pt8))
        }
        .buttonStyle(.plain)
        .focusEffectDisabled()
        .opacity(enabled ? 1 : Theme.Opacity.disabled)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: on)
        .animation(Theme.Motion.hover.animation, value: hover)
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
}

// Kästchen nach Figma „Grundteile Checkbox“ (6:13922): 14, Radius 5, kein Rand; aus secondaryHover (Hover track), an foreground mit Haken 10
// in background; gemischt (G31): Minus 10 in background auf foreground.
struct WebCheckbox: View {
    let on: Bool
    var mixed = false
    @State private var hover = false

    var body: some View {
        let filled = on || mixed
        RoundedRectangle(cornerRadius: Theme.Radius.checkbox)
            .fill(filled ? Theme.Palette.foreground : (hover ? Theme.Palette.track : Theme.Palette.secondaryHover))
            .overlay {
                if filled { Image(systemName: mixed ? "minus" : "checkmark").font(.system(size: Theme.Metrics.pt10, weight: .bold)).foregroundStyle(Theme.Palette.background) }
            }
            .frame(width: Theme.Metrics.pt14, height: Theme.Metrics.pt14)
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: on)
            .animation(Theme.Motion.hover.animation, value: hover)
    }
}

// Regler (Slider): Spur 4 muted, Bereich primary, Griff 12 weiß mit Rand ring, Hover/Ziehen 3 pt ring/50 %.
struct WebSlider: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let label: String
    @State private var hover = false
    @State private var dragging = false

    var body: some View {
        GeometryReader { box in
            let w = box.size.width
            let f = (value - range.lowerBound) / (range.upperBound - range.lowerBound)
            let x = Theme.Metrics.pt6 + (w - Theme.Metrics.pt12) * f
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.Palette.muted).frame(height: Theme.Metrics.pt4)
                Capsule().fill(Theme.Palette.primary).frame(width: x, height: Theme.Metrics.pt4)
                Circle().fill(Theme.Palette.thumb).frame(width: Theme.Metrics.pt12, height: Theme.Metrics.pt12)
                    .overlay(Circle().strokeBorder(Theme.Palette.ring, lineWidth: Theme.Metrics.pt1))
                    .background { if hover || dragging { Circle().fill(Theme.Palette.ring.opacity(0.5)).padding(-Theme.Metrics.pt3) } }
                    .offset(x: x - Theme.Metrics.pt6)
            }
            .frame(height: box.size.height)
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: Theme.Metrics.pt0).onChanged { g in
                dragging = true
                let t = min(1, max(0, (g.location.x - Theme.Metrics.pt6) / max(Theme.Metrics.pt1, w - Theme.Metrics.pt12)))
                value = range.lowerBound + t * (range.upperBound - range.lowerBound)
            }.onEnded { _ in dragging = false })
        }
        .frame(height: Theme.Metrics.pt16)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: hover || dragging)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue("\(Int(((value - range.lowerBound) / (range.upperBound - range.lowerBound) * 100).rounded())) %")
        .accessibilityAdjustableAction { direction in
            let step = (range.upperBound - range.lowerBound) / 20
            value = min(range.upperBound, max(range.lowerBound, value + (direction == .increment ? step : -step)))
        }
    }
}

// Segment im Glas-Stil (Panel-Reiter, Augenform): Pille 32, Fläche foreground 6 %, Ring 10 %; Markierung foreground 15 % mit Ring
// und Schatten gleitet 200 ms ease-out zum gewählten Eintrag. Inaktiv muted, Hover foreground 5 %.
struct WebSegment<Item: Hashable>: View {
    let items: [Item]
    @Binding var selection: Item
    let title: (Item) -> String
    @Namespace private var space
    @State private var hovered: Item?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: Theme.Metrics.pt0) {
            ForEach(items, id: \.self) { item in
                let active = item == selection
                Button { selection = item } label: {
                    Text(title(item)).font(Theme.Fonts.bodyMedium).lineLimit(1)
                        .foregroundStyle(active ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                        .padding(.horizontal, Theme.Metrics.pt6)
                        .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt24)
                        .background {
                            if active {
                                Capsule().fill(Theme.Palette.glassActive)
                                    .overlay(Capsule().strokeBorder(Theme.Palette.glassActive, lineWidth: Theme.Metrics.pt1))
                                    .shadow(color: Theme.Palette.shadow.opacity(0.1), radius: Theme.Metrics.pt1_5, y: Theme.Metrics.pt1)
                                    .matchedGeometryEffect(id: "mark", in: space)
                            } else if hovered == item {
                                Capsule().fill(Theme.Palette.foreground.opacity(0.05))
                            }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .onHover { hovered = $0 ? item : (hovered == item ? nil : hovered) }
                .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(Theme.Metrics.pt4)
        .frame(height: Theme.Metrics.pt32)
        .background(.ultraThinMaterial, in: .capsule)
        .background(Theme.Palette.glass, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt1))
        .animation(reduceMotion ? nil : Theme.Motion.tab.animation, value: selection)
    }
}

@MainActor @Observable final class OverlayCenter {
    struct Menu {
        var anchor: CGRect
        var items: [WebMenuItem]
        var alignment: HorizontalAlignment = .leading
        var minWidth: CGFloat = Theme.Menu.minWidth
        var matchAnchorWidth = false
        var atPoint = false
        // Öffnet über dem Anker (Composer: Web side="top") und zeigt statt der Einträge eine eigene Ansicht (Modellwahl).
        var above = false
        var custom: AnyView?
        var customWidth: CGFloat = Theme.Metrics.pt256
        // Feste Breite der Liste (Web: w-64 mit abgeschnittener Beschreibung).
        var fixedWidth: CGFloat?
    }
    struct Tooltip: Equatable {
        var text: String
        var anchor: CGRect
        var edge: Edge = .top
    }
    // Hover-Karte (HoverCard): über dem Anker, linksbündig.
    struct HoverCard {
        let id = UUID()
        var anchor: CGRect
        var content: AnyView
    }
    // Vollbild eines Bilds (Web: ImagePreview-Dialog).
    struct Viewer {
        let id = UUID()
        let image: NSImage
        let alt: String
        let filename: String
    }
    var menu: Menu?
    var tooltip: Tooltip?
    var hoverCard: HoverCard?
    var viewer: Viewer?
    // Rechtsklick-Bereiche im Fenster (Rahmen im Fensterraum, Einträge beim Öffnen gebaut).
    var contextRegions: [UUID: (frame: CGRect, items: () -> [WebMenuItem])] = [:]

    func openContext(at point: CGPoint) -> Bool {
        let hits = contextRegions.values.filter { $0.frame.contains(point) }
        guard let region = hits.min(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { return false }
        let items = region.items()
        guard !items.isEmpty else { return false }
        tooltip = nil
        menu = Menu(anchor: CGRect(origin: point, size: .zero), items: items, atPoint: true)
        return true
    }
}

extension EnvironmentValues {
    @Entry var overlay: OverlayCenter?
    // Screenshot-Szenen: Name des Menüs/Tooltips, das sich selbst öffnet.
    @Entry var screenAction: String?
}

// Knopf, der ein Menü im Web-Stil unter sich öffnet.
struct WebMenuButton<Label: View>: View {
    var alignment: HorizontalAlignment = .leading
    var matchWidth = false
    var above = false
    var minWidth: CGFloat = Theme.Menu.minWidth
    var screenName: String?
    var fixedWidth: CGFloat?
    var custom: (() -> AnyView)?
    var customWidth: CGFloat = Theme.Metrics.pt256
    let items: () -> [WebMenuItem]
    @ViewBuilder let label: (_ open: Bool) -> Label
    @Environment(\.overlay) private var overlay
    @Environment(\.screenAction) private var screenAction
    @State private var frame: CGRect = .zero
    @State private var openedAt: CGRect?

    var body: some View {
        let open = overlay?.menu != nil && openedAt == overlay?.menu?.anchor
        Button {
            if open { overlay?.menu = nil } else { show() }
        } label: { label(open) }
        .buttonStyle(.plain)
        .probe(screenName.map { "menu-anchor-" + $0 } ?? "menu-anchor")
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { new in
            frame = new
            if let screenName, screenName == screenAction, overlay?.menu == nil, new.width > 0 { show() }
        }
    }

    private func show() {
        guard let overlay else { return }
        openedAt = frame
        overlay.tooltip = nil
        overlay.menu = .init(anchor: frame, items: custom == nil ? items() : [], alignment: alignment, minWidth: minWidth, matchAnchorWidth: matchWidth, above: above, custom: custom?(), customWidth: customWidth, fixedWidth: fixedWidth)
    }
}

extension View {
    // Hover-Karte nach 100 ms Verweilen (Web: HoverCard delay 100).
    func webHoverCard<Card: View>(@ViewBuilder _ card: @escaping () -> Card) -> some View { modifier(HoverCardAnchor(card: { AnyView(card()) })) }

    // Rechtsklick öffnet ein Menü im Web-Stil an der Zeigerposition (Entscheidung 4g: nur Aktionen, die das Web für das Objekt hat).
    // `screenName`: Screenshot-Szenen öffnen das Menü in der Mitte des Bereichs, wenn `screenAction` gleich ist.
    func webContextMenu(screenName: String? = nil, _ items: @escaping () -> [WebMenuItem]) -> some View { modifier(ContextRegion(items: items, screenName: screenName)) }

    // Tooltip wie TooltipContent (Fläche foreground, Text background, sofort).
    func webTooltip(_ text: String, edge: Edge = .top, enabled: Bool = true) -> some View { modifier(TooltipAnchor(text: text, edge: edge, enabled: enabled)) }
}

private struct ContextRegion: ViewModifier {
    let items: () -> [WebMenuItem]
    var screenName: String?
    @Environment(\.overlay) private var overlay
    @Environment(\.screenAction) private var screenAction
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { frame in
                overlay?.contextRegions[id] = (frame, items)
                if let screenName, screenName == screenAction, overlay?.menu == nil, frame.width > 0 { _ = overlay?.openContext(at: CGPoint(x: frame.midX, y: frame.midY)) }
            }
            .onDisappear { overlay?.contextRegions[id] = nil }
    }
}

private struct HoverCardAnchor: ViewModifier {
    let card: () -> AnyView
    @Environment(\.overlay) private var overlay
    @State private var frame: CGRect = .zero
    @State private var shown: UUID?

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { frame = $0 }
            .onHover { inside in
                guard let overlay else { return }
                if inside {
                    Task {
                        try? await Task.sleep(for: .seconds(Theme.Motion.pop.duration))
                        guard overlay.menu == nil else { return }
                        let item = OverlayCenter.HoverCard(anchor: frame, content: card())
                        shown = item.id
                        overlay.hoverCard = item
                    }
                } else {
                    if overlay.hoverCard?.id == shown { overlay.hoverCard = nil }
                    shown = nil
                }
            }
    }
}

private struct TooltipAnchor: ViewModifier {
    let text: String
    let edge: Edge
    let enabled: Bool
    @Environment(\.overlay) private var overlay
    @State private var frame: CGRect = .zero

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { frame = $0 }
            .onHover { inside in
                guard let overlay else { return }
                if inside && enabled && overlay.menu == nil { overlay.tooltip = .init(text: text, anchor: frame, edge: edge) }
                else if overlay.tooltip?.anchor == frame { overlay.tooltip = nil }
            }
            .onChange(of: enabled) { if !enabled, overlay?.tooltip?.anchor == frame { overlay?.tooltip = nil } }
    }
}

// Ebene über dem Fenster: offenes Menü (mit Klick daneben = schließen, Pfeiltasten, Enter, Esc) und Tooltip.
struct OverlayLayer: View {
    let center: OverlayCenter
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var monitor: Any?
    @State private var host = WindowBox()

    var body: some View {
        GeometryReader { box in
            ZStack(alignment: .topLeading) {
                DialogLayer(visible: center.viewer != nil, onDismiss: { center.viewer = nil }) {
                    if let viewer = center.viewer {
                        ImageViewerView(viewer: viewer, close: { center.viewer = nil }).frame(width: box.size.width - Theme.Metrics.pt32, height: box.size.height - Theme.Metrics.pt32)
                    }
                }
                if let menu = center.menu {
                    Color.clear.contentShape(.rect)
                        .onTapGesture { center.menu = nil }
                    let container = box.size
                    Placed(place: { CGPoint(x: menuX(menu, width: $0.width, in: container), y: menuY(menu, height: $0.height, in: container)) }) {
                        MenuPanel(menu: menu, close: { center.menu = nil }).probe("overlay-menu")
                    }
                        .transition(reduceMotion ? .opacity : .asymmetric(
                            insertion: .scale(scale: 0.95, anchor: menuAnchor(menu)).combined(with: .opacity).combined(with: .offset(y: menu.atPoint ? Theme.Metrics.pt0 : menu.above ? Theme.Spacing.sm : -Theme.Spacing.sm)),
                            removal: .scale(scale: 0.95, anchor: menuAnchor(menu)).combined(with: .opacity)))
                        .id(menu.anchor.debugDescription + "\(menu.items.count)")
                }
                if let card = center.hoverCard, center.menu == nil {
                    Placed(place: { CGPoint(x: card.anchor.minX, y: card.anchor.minY - Theme.Metrics.pt4 - $0.height) }) {
                    card.content
                        .font(Theme.Fonts.small)
                        .padding(Theme.Metrics.pt12)
                        .frame(width: Theme.Metrics.pt208, alignment: .leading)
                        // Menü-Familie (G14): r14, Rand border 0,5, kein Schatten.
                        .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Radius.xl))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xl).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
                        .foregroundStyle(Theme.Palette.popoverForeground)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                        .allowsHitTesting(false)
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.95, anchor: .bottomLeading).combined(with: .opacity).combined(with: .offset(y: Theme.Metrics.pt8)))
                        .id(card.id)
                }
                if let tip = center.tooltip, center.menu == nil {
                    Placed(place: { CGPoint(x: tooltipX(tip, width: $0.width), y: tooltipY(tip, height: $0.height)) }) {
                        TooltipBubble(text: tip.text, edge: tip.edge)
                    }
                        .allowsHitTesting(false)
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.95).combined(with: .opacity))
                }
            }
            .frame(width: box.size.width, height: box.size.height, alignment: .topLeading)
            .animation(Theme.Motion.pop.animation, value: center.menu?.anchor)
            .animation(Theme.Motion.tooltip.animation, value: center.tooltip)
            .animation(Theme.Motion.pop.animation, value: center.hoverCard?.id)
        }
        .allowsHitTesting(center.menu != nil || center.viewer != nil)
        .background(WindowReader(box: host))
        .onAppear(perform: installMonitor)
        .onDisappear { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil }
    }

    // Rechtsklick: Bereich unter dem Zeiger suchen (Fensterraum, y von oben).
    private func installMonitor() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown) { event in
            guard let window = event.window, let content = window.contentView else { return event }
            let p = event.locationInWindow
            let point = CGPoint(x: p.x, y: content.bounds.height - p.y)
            // Monitore gelten app-weit: nur Rechtsklicks im eigenen Fenster (Hauptfenster und Einstellungen haben je eine Ebene).
            return MainActor.assumeIsolated { window === host.window && center.openContext(at: point) } ? nil : event
        }
    }

    private func menuAnchor(_ menu: OverlayCenter.Menu) -> UnitPoint {
        if menu.above { return menu.alignment == .trailing ? .bottomTrailing : .bottomLeading }
        return menu.atPoint ? .topLeading : menu.alignment == .trailing ? .topTrailing : menu.alignment == .center ? .top : .topLeading
    }

    private func menuX(_ menu: OverlayCenter.Menu, width: CGFloat, in size: CGSize) -> CGFloat {
        let a = menu.anchor
        let x: CGFloat = switch menu.alignment {
        case .trailing where !menu.atPoint: a.maxX - width
        case .center where !menu.atPoint: a.midX - width / 2
        default: a.minX
        }
        return min(max(Theme.Metrics.pt4, x), size.width - width - Theme.Metrics.pt4)
    }

    private func menuY(_ menu: OverlayCenter.Menu, height: CGFloat, in size: CGSize) -> CGFloat {
        if menu.above { return max(Theme.Metrics.pt4, menu.anchor.minY - Theme.Metrics.pt8 - height) }
        let below = menu.anchor.maxY + (menu.atPoint ? Theme.Metrics.pt0 : Theme.Metrics.pt4)
        // Passt das Menü nicht nach unten, öffnet es nach oben (Web: Positioner weicht aus).
        return below + height > size.height - Theme.Metrics.pt4 ? max(Theme.Metrics.pt4, menu.anchor.minY - Theme.Metrics.pt4 - height) : below
    }

    private func tooltipX(_ tip: OverlayCenter.Tooltip, width: CGFloat) -> CGFloat {
        switch tip.edge {
        case .leading: tip.anchor.minX - Theme.Metrics.pt6 - width
        case .trailing: tip.anchor.maxX + Theme.Metrics.pt6
        default: tip.anchor.midX - width / 2
        }
    }

    private func tooltipY(_ tip: OverlayCenter.Tooltip, height: CGFloat) -> CGFloat {
        switch tip.edge {
        case .top: tip.anchor.minY - Theme.Metrics.pt6 - height
        case .bottom: tip.anchor.maxY + Theme.Metrics.pt6
        default: tip.anchor.midY - height / 2
        }
    }
}

// Fenster, in dem eine Ansicht steht (für app-weite Ereignismonitore, die nur ihr eigenes Fenster bedienen sollen).
final class WindowBox { weak var window: NSWindow? }

struct WindowReader: NSViewRepresentable {
    let box: WindowBox
    func makeNSView(context: Context) -> NSView { Reader(box: box) }
    func updateNSView(_ view: NSView, context: Context) {}
    private final class Reader: NSView {
        let box: WindowBox
        init(box: WindowBox) { self.box = box; super.init(frame: .zero) }
        required init?(coder: NSCoder) { nil }
        override func viewDidMoveToWindow() { box.window = window }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }   // nur lesen, Klicks gehen an SwiftUI
    }
}

// Misst den eigenen Inhalt und setzt ihn an die berechnete Stelle (oben links im Fensterraum).
private struct Placed<Content: View>: View {
    let place: (CGSize) -> CGPoint
    @ViewBuilder let content: Content
    @State private var size: CGSize = .zero

    var body: some View {
        let point = place(size)
        content
            .fixedSize()
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .opacity(size == .zero ? 0 : 1)
            .offset(x: point.x, y: point.y)
    }
}

private struct MenuPanel: View {
    let menu: OverlayCenter.Menu
    let close: () -> Void
    @State private var highlighted: UUID?
    @FocusState private var focused: Bool

    var body: some View {
        if let custom = menu.custom {
            custom
                .frame(width: menu.customWidth, alignment: .leading)
                .menuSurface()
                .onKeyPress(.escape) { close(); return .handled }
                .accessibilityElement(children: .contain)
        } else { list }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            ForEach(MenuRows.rows(menu.items)) { entry in
                if entry.separator { MenuSeparator() }
                row(entry.item)
            }
        }
        .frame(minWidth: menu.matchAnchorWidth ? max(menu.minWidth, menu.anchor.width) : menu.minWidth, alignment: .leading)
        .frame(width: menu.fixedWidth, alignment: .leading)
        .menuSurface()
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.escape) { close(); return .handled }
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
        .onKeyPress(.return) {
            guard let item = menu.items.first(where: { $0.id == highlighted && !$0.disabled }) else { return .ignored }
            close(); item.action(); return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }

    private func move(_ step: Int) {
        let ids = menu.items.filter { !$0.disabled }.map(\.id)
        guard !ids.isEmpty else { return }
        let index = highlighted.flatMap { ids.firstIndex(of: $0) } ?? (step > 0 ? -1 : ids.count)
        highlighted = ids[(index + step + ids.count) % ids.count]
    }

    private func row(_ item: WebMenuItem) -> some View {
        Button { close(); item.action() } label: { MenuRowLabel(item: item, lit: highlighted == item.id) }
        .buttonStyle(.plain)
        .disabled(item.disabled)
        .opacity(item.disabled ? Theme.Opacity.disabled : 1)
        .onHover { if $0 && !item.disabled { highlighted = item.id } else if highlighted == item.id { highlighted = nil } }
        .accessibilityAddTraits(item.checked ? [.isButton, .isSelected] : .isButton)
    }
}

// Zeile (Theme.Menu), auch für eigene Menü-Inhalte (Plus-Panel der Eingabe): links Symbol, Avatar oder Haken-Feld, Titel
// (gewählt Medium), optional Beschreibung darunter, rechts grauer Wert, Haken, Chevron. Hover als gerundete Fläche innerhalb
// des Rands, destruktiv rot.
struct MenuRowLabel: View {
    let item: WebMenuItem
    let lit: Bool

    var body: some View {
        let plain = item.leading == nil && item.icon == nil
        HStack(spacing: Theme.Menu.gap) {
            Group {
                if let leading = item.leading { leading }
                else if let icon = item.icon {
                    Image(systemName: icon).font(.system(size: Theme.Menu.iconSize, weight: Theme.Menu.iconWeight))
                        .foregroundStyle(item.destructive ? Theme.Palette.destructive : item.iconTint ?? Theme.Palette.popoverForeground)
                } else {
                    Image(systemName: "checkmark").font(.system(size: Theme.Menu.checkSize, weight: .semibold)).opacity(item.checked ? 1 : 0)
                }
            }
            .frame(width: Theme.Menu.iconFrame, height: Theme.Menu.iconFrame)
            VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                Text(item.title).font(item.checked ? Theme.Menu.titleSelected : Theme.Menu.title).lineLimit(1)
                if let subtitle = item.subtitle {
                    Text(subtitle).font(Theme.Menu.subtitle).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                }
            }
            Spacer(minLength: Theme.Menu.gap)
            if let value = item.value { Text(value).font(Theme.Menu.value).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1) }
            if item.checked && !plain { Image(systemName: "checkmark").font(.system(size: Theme.Menu.checkSize, weight: .semibold)) }
            if item.chevron {
                Image(systemName: "chevron.right").font(.system(size: Theme.Menu.chevronSize, weight: .semibold)).foregroundStyle(Theme.Palette.mutedForeground)
            }
        }
        .foregroundStyle(item.destructive ? Theme.Palette.destructive : Theme.Palette.popoverForeground)
        .padding(.horizontal, Theme.Menu.rowPaddingH)
        .frame(height: item.subtitle == nil ? Theme.Menu.rowHeight : Theme.Menu.tallRowHeight)
        .background(lit ? (item.destructive ? Theme.Palette.destructive.opacity(Theme.Menu.destructiveHover) : Theme.Palette.secondaryHover) : .clear,
                    in: .rect(cornerRadius: Theme.Menu.rowRadius))
        .contentShape(.rect)
    }
}

// Trennlinie zwischen Gruppen eines Menüs.
struct MenuSeparator: View {
    var body: some View {
        Rectangle().fill(Theme.Palette.border).frame(height: Theme.Menu.border)
            .padding(.horizontal, Theme.Menu.separatorInsetH).padding(.vertical, Theme.Menu.separatorInsetV)
    }
}

extension View {
    // Fläche aller Menüs (Liste und eigene Inhalte wie Modellwahl oder Reaktionen): Rand, Ecken, Linie, Farben aus Theme.Menu.
    func menuSurface() -> some View {
        padding(Theme.Menu.padding)
            .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Menu.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.Menu.radius).strokeBorder(Theme.Palette.border, lineWidth: Theme.Menu.border))
            .foregroundStyle(Theme.Palette.popoverForeground)
    }
}

// Tooltip nach Figma (49:16495): Fläche popover, Rand border 0,5, r8, innen 4/8, Text 11 Regular foreground, kein Pfeil.
private struct TooltipBubble: View {
    let text: String
    let edge: Edge

    var body: some View {
        Text(text).font(Theme.Fonts.caption).lineHeight(.exact(points: Theme.Metrics.pt16))
            .foregroundStyle(Theme.Palette.foreground)
            .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt4)
            .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }
}

// Auswahl (Select-Auslöser): Rand input, dunkel input 30 % (Hover 50 %), Chevron 16 muted; Liste als Menü mit Haken.
struct WebSelect<Value: Hashable>: View {
    let options: [(value: Value, title: String)]
    @Binding var selection: Value
    var small = false
    // Auslöser füllt die Breite, Pfeil rechts (Web: SelectTrigger w-full).
    var fill = false
    var label: String

    var body: some View {
        WebMenuButton(matchWidth: true, items: {
            options.map { option in WebMenuItem(title: option.title, checked: option.value == selection) { selection = option.value } }
        }) { open in
            SelectTriggerLabel(title: options.first { $0.value == selection }?.title ?? "", small: small, open: open, fill: fill)
        }
        .accessibilityLabel(label)
    }
}

struct SelectTriggerLabel<Leading: View>: View {
    let title: String
    var small = false
    var open = false
    var fill = false
    var leading: Leading
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled

    init(title: String, small: Bool = false, open: Bool = false, fill: Bool = false, @ViewBuilder leading: () -> Leading) {
        self.title = title; self.small = small; self.open = open; self.fill = fill; self.leading = leading()
    }

    var body: some View {
        // Ausklappfeld nach Figma (6:13685): Innenabstand 12, r12, Regular 12, zu secondary, Hover/offen secondaryHover, kein Rand,
        // Pfeil 13 mutedForeground (offen: nach oben).
        let radius = Theme.Radius.field
        HStack(spacing: Theme.Metrics.pt6) {
            leading
            Text(title).font(Theme.Fonts.small).lineLimit(1).foregroundStyle(Theme.Palette.foreground)
            if fill { Spacer(minLength: Theme.Metrics.pt0) }
            Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: Theme.Metrics.pt11, weight: .medium)).foregroundStyle(Theme.Palette.mutedForeground).frame(width: Theme.Metrics.pt13, height: Theme.Metrics.pt13)
        }
        .padding(.horizontal, Theme.Metrics.pt12)
        .frame(height: Theme.Metrics.pt24)   // eine Größe 24 (G8)
        .background(hover || open ? Theme.Palette.secondaryHover : Theme.Palette.secondary, in: .rect(cornerRadius: radius))
        .contentShape(.rect(cornerRadius: radius))
        .opacity(enabled ? 1 : Theme.Opacity.disabled)   // G9
        .onHover { hover = $0 && enabled }
        .animation(Theme.Motion.hover.animation, value: hover)
    }
}

extension SelectTriggerLabel where Leading == EmptyView {
    init(title: String, small: Bool = false, open: Bool = false, fill: Bool = false) { self.init(title: title, small: small, open: open, fill: fill) { EmptyView() } }
}
