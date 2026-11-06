import AppKit
import SwiftUI

// Ansicht des Computers: eine ebenengestützte NSView zeigt das Bild (Seitenverhältnis bleibt), nimmt Maus und Tastatur an und
// übersetzt sie auf RFB. Die Vorschau im Panel nimmt keine Eingabe an (Web: pointer-events-none, Klick öffnet den Vollbildmodus).
final class DesktopNSView: NSView, @preconcurrency NSTextInputClient {
    weak var session: DesktopSession?
    var interactive = false { didSet { if !interactive { releaseAll() }; window?.invalidateCursorRects(for: self) } }
    var onFocusChange: ((Bool) -> Void)?
    private var buttons: UInt8 = 0
    private var lastRemote = (x: -1, y: -1)
    private var pressedKeys: [UInt16: UInt32] = [:]
    private var scrollRest: CGFloat = 0
    private var cursorShape: CursorShape?
    private var cursorCache: NSCursor?
    private var tracking: NSTrackingArea?
    private(set) var focused = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.contentsGravity = .resizeAspect
        layer?.minificationFilter = .trilinear
        layer?.magnificationFilter = .linear
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override var acceptsFirstResponder: Bool { interactive }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { interactive }
    // Die Vorschau lässt Klicks durch, damit der Knopf darunter den Vollbildmodus öffnet.
    override func hitTest(_ point: NSPoint) -> NSView? { interactive ? super.hitTest(point) : nil }

    func show(_ image: CGImage?, scale: CGFloat) {
        layer?.contentsScale = scale
        layer?.contents = image
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    // MARK: Zeiger

    func setCursor(_ shape: CursorShape?) {
        guard shape != cursorShape else { return }
        cursorShape = shape
        cursorCache = shape.flatMap(Self.makeCursor)
        window?.invalidateCursorRects(for: self)
    }

    override func resetCursorRects() {
        if interactive { addCursorRect(bounds, cursor: cursorCache ?? .arrow) }
    }

    private static func makeCursor(_ shape: CursorShape) -> NSCursor? {
        guard let provider = CGDataProvider(data: Data(shape.rgba) as CFData),
              let image = CGImage(width: shape.width, height: shape.height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: shape.width * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
                                  decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return nil }
        let ns = NSImage(cgImage: image, size: NSSize(width: shape.width, height: shape.height))
        return NSCursor(image: ns, hotSpot: NSPoint(x: shape.hotspotX, y: shape.hotspotY))
    }

    private func remote(_ event: NSEvent) -> (x: Int, y: Int)? {
        guard let session, session.size.width > 0 else { return nil }
        let p = convert(event.locationInWindow, from: nil)
        return DesktopGeometry.remote(CGPoint(x: p.x, y: bounds.height - p.y), content: session.size, in: bounds.size)
    }

    private func sendPointer(_ event: NSEvent) {
        guard interactive, let point = remote(event) else { return }
        // Bewegungen ohne neue Bildposition gar nicht senden.
        if point == lastRemote, !(event.type == .leftMouseDown || event.type == .rightMouseDown || event.type == .otherMouseDown || event.type == .leftMouseUp || event.type == .rightMouseUp || event.type == .otherMouseUp) { return }
        lastRemote = point
        session?.pointer(x: point.x, y: point.y, buttons: buttons)
    }

    override func mouseMoved(with event: NSEvent) { sendPointer(event) }
    override func mouseDragged(with event: NSEvent) { sendPointer(event) }
    override func rightMouseDragged(with event: NSEvent) { sendPointer(event) }
    override func otherMouseDragged(with event: NSEvent) { sendPointer(event) }

    private func press(_ mask: UInt8, down: Bool, _ event: NSEvent) {
        guard interactive else { return }
        if down { window?.makeFirstResponder(self); buttons |= mask } else { buttons &= ~mask }
        sendPointer(event)
    }

    override func mouseDown(with event: NSEvent) { press(1, down: true, event) }
    override func mouseUp(with event: NSEvent) { press(1, down: false, event) }
    override func rightMouseDown(with event: NSEvent) { press(4, down: true, event) }
    override func rightMouseUp(with event: NSEvent) { press(4, down: false, event) }
    override func otherMouseDown(with event: NSEvent) { press(2, down: true, event) }
    override func otherMouseUp(with event: NSEvent) { press(2, down: false, event) }

    // Rad: Taste 4 (hoch) und 5 (runter) als kurzer Druck; Trackpad-Strecken werden in Rasten zu je 12 Punkten gezählt.
    override func scrollWheel(with event: NSEvent) {
        guard interactive, let point = remote(event) else { return }
        scrollRest += event.hasPreciseScrollingDeltas ? event.scrollingDeltaY / 12 : event.scrollingDeltaY
        let notches = Int(scrollRest)
        guard notches != 0 else { return }
        scrollRest -= CGFloat(notches)
        let mask: UInt8 = notches > 0 ? 8 : 16
        for _ in 0..<min(abs(notches), 10) {
            session?.pointer(x: point.x, y: point.y, buttons: buttons | mask)
            session?.pointer(x: point.x, y: point.y, buttons: buttons)
        }
    }

    // MARK: Tastatur

    override func becomeFirstResponder() -> Bool {
        guard interactive else { return false }
        focused = true
        onFocusChange?(true)
        session?.syncClipboardToComputer()
        return true
    }

    override func resignFirstResponder() -> Bool {
        focused = false
        releaseAll()
        onFocusChange?(false)
        return true
    }

    // Nichts bleibt „gedrückt“, wenn der Fokus geht.
    func releaseAll() {
        for (_, keysym) in pressedKeys { session?.key(keysym, down: false) }
        pressedKeys.removeAll()
        if buttons != 0, lastRemote.x >= 0 { session?.pointer(x: lastRemote.x, y: lastRemote.y, buttons: 0) }
        buttons = 0
    }

    override func flagsChanged(with event: NSEvent) {
        guard interactive, let keysym = DesktopKeys.modifiers[event.keyCode] else { return }
        let flag: NSEvent.ModifierFlags = switch event.keyCode {
        case 56, 60: .shift
        case 59, 62: .control
        default: .command
        }
        let down = event.modifierFlags.contains(flag)
        if down { pressedKeys[event.keyCode] = keysym } else { pressedKeys[event.keyCode] = nil }
        session?.key(keysym, down: down)
    }

    // Befehl-Kürzel gehen an den Computer (als Strg), außer denen, die macOS oder Orbit behalten.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard interactive, window?.firstResponder === self, event.modifierFlags.contains(.command) else { return false }
        let char = event.charactersIgnoringModifiers?.lowercased() ?? ""
        if DesktopKeys.reserved.contains(char) { return false }
        keyDown(with: event)
        return true
    }

    override func keyDown(with event: NSEvent) {
        guard interactive else { return }
        let flags = event.modifierFlags
        if let keysym = DesktopKeys.special[event.keyCode] {
            pressedKeys[event.keyCode] = keysym
            session?.key(keysym, down: true)
            return
        }
        // Mit Strg oder Befehl zählt die Taste, nicht das erzeugte Zeichen (Strg+C kommt als Steuerzeichen an).
        if flags.contains(.control) || flags.contains(.command), let scalar = event.charactersIgnoringModifiers?.lowercased().unicodeScalars.first,
           let keysym = DesktopKeys.keysym(forScalar: scalar.value) {
            // Einfügen: erst den Text des Macs hinüber, dann Strg+V.
            if flags.contains(.command), scalar == "v" { session?.syncClipboardToComputer(force: true) }
            pressedKeys[event.keyCode] = keysym
            session?.key(keysym, down: true)
            return
        }
        // Alles andere setzt das Eingabesystem zusammen (Wahltaste, tote Tasten, Eingabemethoden) und liefert fertige Zeichen.
        interpretKeyEvents([event])
    }

    override func keyUp(with event: NSEvent) {
        guard interactive, let keysym = pressedKeys.removeValue(forKey: event.keyCode) else { return }
        session?.key(keysym, down: false)
        // Kopieren: der Computer meldet die Auswahl gleich über ServerCutText (landet in der Zwischenablage des Macs).
    }

    // MARK: NSTextInputClient (fertige Zeichen)

    func insertText(_ string: Any, replacementRange: NSRange) {
        let text = (string as? NSAttributedString)?.string ?? (string as? String) ?? ""
        for scalar in text.unicodeScalars {
            guard let keysym = DesktopKeys.keysym(forScalar: scalar.value) else { continue }
            session?.key(keysym, down: true)
            session?.key(keysym, down: false)
        }
    }

    override func doCommand(by selector: Selector) {}
    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {}
    func unmarkText() {}
    func selectedRange() -> NSRange { NSRange(location: NSNotFound, length: 0) }
    func markedRange() -> NSRange { NSRange(location: NSNotFound, length: 0) }
    func hasMarkedText() -> Bool { false }
    func attributedSubstring(forProposedRange range: NSRange, actualRange: NSRangePointer?) -> NSAttributedString? { nil }
    func validAttributesForMarkedText() -> [NSAttributedString.Key] { [] }
    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect { .zero }
    func characterIndex(for point: NSPoint) -> Int { NSNotFound }
}

struct DesktopCanvas: NSViewRepresentable {
    let session: DesktopSession
    var interactive: Bool
    var onFocusChange: ((Bool) -> Void)?
    @Environment(\.displayScale) private var scale

    func makeNSView(context: Context) -> DesktopNSView {
        let view = DesktopNSView(frame: .zero)
        view.session = session
        return view
    }

    func updateNSView(_ view: DesktopNSView, context: Context) {
        view.session = session
        view.interactive = interactive
        view.onFocusChange = onFocusChange
        view.show(session.frame, scale: scale)
        view.setCursor(session.cursor)
    }
}

// Inhalt des Reiters „Computer“ im Seitenpanel und im Vollbild. Zustände: startet, verbindet, verbunden, getrennt (mit Wiederverbinden),
// Fehler, kein Computer, Dienst offline. Die Fläche ist im Panel 16:9 (Web: aspect-video), im Vollbild füllt sie den Rahmen.
struct ComputerView: View {
    let model: AppModel
    let session: DesktopSession
    var fullscreen = false
    @State private var focused = false
    @State private var hover = false

    var body: some View {
        Group {
            if fullscreen { surface } else {
                // Panel: Klick öffnet den Vollbildmodus (Web: Knopf mit Hinweis unten rechts beim Überfahren).
                Button { model.desktopFullscreen = session.botId } label: {
                    surface.overlay(alignment: .bottomTrailing) {
                        Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 13)).padding(Theme.Metrics.pt6)
                            .background(Theme.Palette.background, in: .rect(cornerRadius: Theme.Radius.md)).padding(Theme.Metrics.pt8)   // Figma 143:53716: Fläche voll
                            .opacity(hover && session.state == .connected ? 1 : 0).animation(Theme.Motion.hover.animation, value: hover)
                    }
                }
                .buttonStyle(.plain)
                .disabled(session.state != .connected)
                .onHover { hover = $0 }
                .aspectRatio(16 / 9, contentMode: .fit)
                .accessibilityLabel("Computer im Vollbild öffnen")
            }
        }
        .task(id: model.panelOpen || fullscreen) {
            if model.panelOpen || fullscreen { session.activate() } else { session.deactivate() }
        }
        .onDisappear { if !fullscreen { session.deactivate() } }
    }

    private var surface: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Theme.Radius.lg).fill(Theme.Palette.muted)
            if session.frame != nil {
                DesktopCanvas(session: session, interactive: fullscreen && session.interactive, onFocusChange: { focused = $0 })
                    .clipShape(.rect(cornerRadius: Theme.Radius.lg))
                    .opacity(dimmed ? 0.4 : 1)
            }
            overlay
        }
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))   // Figma 143:53684: Ring 0,5
        .webFocusRing(focused, radius: Theme.Radius.lg)
        .frame(maxWidth: .infinity, maxHeight: fullscreen ? .infinity : nil)
        .overlay(alignment: .bottom) {
            if let notice = session.notice, fullscreen {
                Text(notice).font(Theme.Fonts.small).padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Theme.Palette.card, in: .capsule).overlay(Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5)).padding(Theme.Metrics.pt8)   // Figma 143:53991
            }
        }
        .probe(fullscreen ? "desktop-fullscreen" : "desktop-panel")
        .animation(Theme.Motion.fadeIn.animation, value: session.state)
    }

    private var dimmed: Bool {
        switch session.state {
        case .connected: false
        default: true
        }
    }

    @ViewBuilder private var overlay: some View {
        switch session.state {
        case .idle:
            ComputerPlaceholder()
        case .preparing, .connecting:
            ZStack {
                if session.frame == nil { ComputerPlaceholder() }
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    HStack(spacing: 8) { Spinner(size: 16); Text(session.progressText(now: context.date)).font(Theme.Fonts.body) }
                        .foregroundStyle(Theme.Palette.mutedForeground)
                }
            }
        case .connected:
            EmptyView()
        case .noComputer(let text):
            status(text, symbol: "desktopcomputer", retry: nil, destructive: false)
        case .offline(let text):
            status(text, symbol: "wifi.slash", retry: "Erneut versuchen", destructive: true)
        case .failed(let text):
            status(text, symbol: "exclamationmark.triangle", retry: "Erneut versuchen", destructive: true)
        case .disconnected(let text, let retryIn):
            status(retryIn.map { "\(text) Neuer Versuch in \($0) s." } ?? text, symbol: "bolt.slash", retry: "Wiederverbinden", destructive: true)
        }
    }

    private func status(_ text: String, symbol: String, retry: String?, destructive: Bool) -> some View {
        VStack(spacing: 12) {
            if destructive { SettingsAlert(text: text, symbol: symbol).frame(maxWidth: 360) }
            else {
                VStack(spacing: 8) {
                    Image(systemName: symbol).font(.system(size: 16)).frame(width: 32, height: 32).background(Theme.Palette.muted, in: .rect(cornerRadius: Theme.Radius.md))   // Figma 143:58512: r8
                    Text(text).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground).multilineTextAlignment(.center)
                }
            }
            if let retry { Button(retry) { session.reconnect() }.buttonStyle(.card(.outline, small: true)) }
        }
        .padding(Theme.Metrics.pt16)
    }
}

// Vollbild (Web: Dialog 95 % × 90 %, Innenabstand 12, oben 40; nur der Schließen-Knopf schließt, Esc geht an den Computer).
struct DesktopFullscreen: View {
    let model: AppModel
    let session: DesktopSession

    var body: some View {
        GeometryReader { box in
            VStack(spacing: 0) {
                ComputerView(model: model, session: session, fullscreen: true)
            }
            .padding(.horizontal, 12).padding(.bottom, 12).padding(.top, 40)
            .frame(width: min(box.size.width * 0.95, box.size.width - 32), height: min(box.size.height * 0.9, box.size.height - 32))
            // Figma Computer-Vollbild (143:53984): Fläche card, r16, Ring 0,5.
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Metrics.pt16))
            .overlay(alignment: .topTrailing) {
                Button { model.desktopFullscreen = nil } label: { Image(systemName: "xmark").font(.system(size: 14)) }
                    .buttonStyle(.web(.ghost, .iconSmall)).padding(Theme.Metrics.pt8).accessibilityLabel("Schließen")
            }
            .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt16).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))
            .foregroundStyle(Theme.Palette.popoverForeground)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Computer von \(session.botName)")
        }
    }
}
