import AppKit
import SwiftUI

// Animation außerhalb des SwiftUI-Renderers: Ein SwiftUI-Animationsbild baut das ganze Fenster neu auf (2 bis 5 ms CPU), deshalb
// zeichnet jede Figur in einen eigenen Layer (Core Graphics, ca. 0,15 ms) und nur dieser Layer wird aktualisiert.
// Nur sichtbare Figuren laufen (Fenster sichtbar und App aktiv), alle teilen einen Takt.

@MainActor
protocol Ticking: AnyObject {
    var tickInterval: Double { get }
    var tickVisible: Bool { get }
    func tick(now: TimeInterval)
}

// Gemeinsamer, anpassbarer Takt; Bilder liegen auf einem 1/60-s-Raster und fallen zusammen.
@MainActor
final class FigureTicker {
    static let shared = FigureTicker()
    private var items = NSHashTable<AnyObject>.weakObjects()
    private var due: [ObjectIdentifier: TimeInterval] = [:]
    private(set) var timer: Timer?

    func add(_ t: Ticking) { items.add(t); wake(t) }
    func wake(_ t: Ticking) {
        due[ObjectIdentifier(t)] = 0
        schedule()
    }

    private func schedule() {
        let live = items.allObjects.compactMap { $0 as? Ticking }.filter { $0.tickVisible }
        guard let g = live.map(\.tickInterval).min() else { return }
        let now = Date.timeIntervalSinceReferenceDate
        let grid = 1.0 / 60
        let step = max(grid, (g / grid).rounded() * grid)
        let next = (floor(now / grid) + max(1, (step / grid).rounded())) * grid
        if let timer, timer.fireDate.timeIntervalSinceReferenceDate <= next { return }
        timer?.invalidate()
        let t = Timer(fire: Date(timeIntervalSinceReferenceDate: next), interval: 0, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.fire() }
        }
        t.tolerance = 0.002
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func fire() {
        timer = nil
        let now = Date.timeIntervalSinceReferenceDate
        for case let t as Ticking in items.allObjects where t.tickVisible {
            let key = ObjectIdentifier(t)
            if now + 0.004 >= (due[key] ?? 0) { t.tick(now: now); due[key] = now + t.tickInterval - 0.004 }
        }
        schedule()
    }
}

// Wo die Figur steht: bestimmt, ob sie Zustände zeigt und auf die Maus reagiert (Design Orbis, 27.10.2026).
// sidebar = Status-Animationen und Maus im eigenen Feld; header = Avatar oben im Chat (wie „ausgewählt“, Maus im Kopf);
// message = neben Nachrichten und überall sonst (geradeaus, kein Status, keine Maus); editor = Vorschau im Anpassungsmenü (frühere Animation).
final class FigureLayerView: NSView, Ticking {
    private var look = OrbiLook(shape: .strobi)
    private var state = OrbiState.calm
    private var reduced = false
    private var chatOpen = false
    private var follow = true
    private var hoverArea = false     // Zeiger steht irgendwo im Feld der Zeile: Blick folgt (weiche Reichweite statt nur über der Figur)
    private var role = FigureRole.editor
    private let behavior = OrbiBehavior()
    private var pose = OrbiPose()
    private var player: AvatarPlayer?
    private var playerShape: OrbiShape?
    private var windowVisible = true
    private var observers: [NSObjectProtocol] = []
    private var lastSignature = ""
    private let content = CALayer()
    private let previousContent = CALayer()
    private var transitionStart: TimeInterval?
    private var renderedSize = CGSize.zero
    private var lastBehaviorPose: OrbiPose?
    private var live = false
    private var pull = CGPoint.zero         // Zug zur Maus (−1…1, y nach unten), geglättet: Augen und Kopf drehen sich dorthin
    private var lastTick = 0.0
    private var interval = 1.0 / 30
    // Höchstbewegung zur Maus: Augen in Engine-Einheiten (Kugel = 240), Kopf in Grad.
    private static let eyeReach = 18.0
    private static let headReach = 22.0

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.masksToBounds = false
        content.contentsGravity = .resize
        content.magnificationFilter = .linear
        layer?.addSublayer(content)
        previousContent.contentsGravity = .resize
        previousContent.magnificationFilter = .linear
        previousContent.opacity = 0
        layer?.addSublayer(previousContent)
        setAccessibilityElement(false)
    }
    required init?(coder: NSCoder) { fatalError() }
    // Rand in Einheiten der 80 breiten Sicht: Satelliten und Schweben ragen über das Feld.
    static let margin = 24.0
    private var inflated: CGRect {
        let m = Self.margin / 80 * bounds.width
        return bounds.insetBy(dx: -m, dy: -m)
    }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    var tickInterval: Double { interval }
    var tickVisible: Bool { windowVisible && window != nil && NSApp.isActive }

    // `live` bleibt für die Aufrufer; der Körper folgt der Maus nicht mehr, nur die Augen beim Darüberfahren (`follow`).
    func apply(look: OrbiLook, state: OrbiState, reduceMotion: Bool, live: Bool = false, chatOpen: Bool = false, follow: Bool = true, hoverArea: Bool = false, role: FigureRole = .editor) {
        let wasLab = mood == nil
        let changed = look != self.look || state != self.state || reduced != reduceMotion || chatOpen != self.chatOpen || role != self.role
        let pointerChanged = hoverArea != self.hoverArea || follow != self.follow
        if changed && !reduceMotion, let image = content.contents {
            CATransaction.begin(); CATransaction.setDisableActions(true)
            previousContent.contents = image; previousContent.opacity = 1
            CATransaction.commit()
            transitionStart = Date.timeIntervalSinceReferenceDate
        } else if reduceMotion {
            transitionStart = nil
            CATransaction.begin(); CATransaction.setDisableActions(true)
            previousContent.opacity = 0; previousContent.contents = nil
            CATransaction.commit()
        }
        self.look = look; self.state = state; self.live = live; self.chatOpen = chatOpen; self.follow = follow; self.hoverArea = hoverArea; self.role = role
        reduced = reduceMotion
        layer?.masksToBounds = role == .message
        if let mood {
            if wasLab { player = nil; playerShape = nil }
            behavior.setMood(mood)
        }
        if changed || pointerChanged {
            lastSignature = ""; lastBehaviorPose = nil; tick(now: Date.timeIntervalSinceReferenceDate)
            FigureTicker.shared.wake(self)
        }
    }

    // Verhalten nach Artifact „Orbi Zustände“; nil = frühere Animation (Vorschau im Editor, Limit, Fehler).
    private var mood: OrbiMood? { FigureMode.mood(role: role, state: state, chatOpen: chatOpen) }

    // Blickrichtung zur Maus (y nach unten) für die neuen Bewegungen: nur im eigenen Feld, volle Wirkung ab etwa 1,4 Figurbreiten Abstand.
    private func mouseLook(now: TimeInterval) -> CGPoint? {
        guard FigureMode.tracksPointer(role: role, hoverArea: hoverArea), let f = screenFrame else { return nil }
        PointerTracker.shared.poll(now: now)
        let p = PointerTracker.shared.location
        let delta = CGPoint(x: p.x - f.midX, y: -(p.y - f.midY))
        return FigureMode.mouseLook(delta: delta, width: f.width, enhanced: role == .header || role == .panel || role == .empty)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        guard let w = window else {
            let now = Date.timeIntervalSinceReferenceDate
            behavior.setRunning(false, now: now); player?.setRunning(false, now: now)
            return
        }
        windowVisible = w.occlusionState.contains(.visible)
        behavior.setRunning(tickVisible, now: Date.timeIntervalSinceReferenceDate)
        observers.append(NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: w, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.windowVisible = w.occlusionState.contains(.visible); self?.wakeUp() }
        })
        // Bei inaktiver App pausieren, beim Zurückkommen sofort weiter.
        for name in [NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.wakeUp() }
            })
        }
        FigureTicker.shared.add(self)
    }

    private func wakeUp() {
        lastSignature = ""
        let now = Date.timeIntervalSinceReferenceDate
        behavior.setRunning(tickVisible, now: now); player?.setRunning(tickVisible, now: now)
        FigureTicker.shared.wake(self)
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        content.frame = inflated
        previousContent.frame = inflated
        CATransaction.commit()
        if renderedSize != bounds.size { renderedSize = bounds.size; lastBehaviorPose = nil; tick(now: Date.timeIntervalSinceReferenceDate) }
    }

    // Zug zur Maus (−1…1, y nach unten): nur wenn der Zeiger über der Figur steht (± 3 pt), sonst Mitte.
    static func hoverVector(pointer p: CGPoint, frame f: CGRect) -> CGPoint {
        guard f.insetBy(dx: -3, dy: -3).contains(p) else { return .zero }
        var dx = (p.x - f.midX) / (f.width / 2), dy = -(p.y - f.midY) / (f.height / 2)
        let len = hypot(dx, dy)
        if len > 1 { dx /= len; dy /= len }
        return CGPoint(x: dx, y: dy)
    }

    // Zeiger irgendwo in der Zeile: Zug nach Abstand (volle Wirkung ab ca. 110 pt), damit auch ein Zeiger rechts im Feld die Augen dreht.
    static func areaVector(pointer p: CGPoint, frame f: CGRect) -> CGPoint {
        var dx = (p.x - f.midX) / 110, dy = -(p.y - f.midY) / 110
        let len = hypot(dx, dy)
        if len > 1 { dx /= len; dy /= len }
        return CGPoint(x: dx, y: dy)
    }

    // Blickversatz der Augen zur Maus (Engine-Einheiten).
    static func hoverTarget(pointer: CGPoint, frame: CGRect, gaze: Double) -> CGPoint {
        let v = hoverVector(pointer: pointer, frame: frame)
        return CGPoint(x: v.x * eyeReach * gaze, y: v.y * eyeReach * gaze)
    }

    // Pose → Engine: Blick als Kopfdrehung plus Augenversatz, Augengröße und -neigung, Blinzeln, Überschlag und Drehung auf dem Kopfwinkel.
    static func geometry(look: OrbiLook, pose: OrbiPose, fine: Bool) -> AvatarGeometry {
        var expression = AvatarEngine.shared.definition(look.shape).neutral
        let g = look.gaze
        expression.v[0] += -pose.ly * headReach * g + pose.flipX
        expression.v[1] += pose.lx * headReach * g + pose.flipY
        for i in 3...6 { expression.v[i] *= pose.es }
        expression.v[12] += pose.rot; expression.v[13] -= pose.rot
        let eye = CGPoint(x: pose.lx * eyeReach * g, y: pose.ly * eyeReach * g)
        return AvatarEngine.shared.geometry(shape: look.shape, expression: expression, blink: 1 - 0.94 * pose.blink, eye: eye, fine: fine)
    }

    // Neue Bewegungen: Pose berechnen, Blick und Augen in die Engine, Körperbewegung und Zeichen in den Renderer.
    private func tickBehavior(now: TimeInterval, mood: OrbiMood) {
        let grid = bounds.width > 60 ? 1.0 / 48 : 1.0 / 30
        if reduced {
            pose = OrbiBehavior.still(behavior.mood)
        } else {
            pose = behavior.step(now: now, run: tickVisible, mouse: mouseLook(now: now))
        }
        interval = reduced ? 0.5 : behavior.settled && !hoverArea ? min(0.5, max(grid, behavior.untilNextEvent)) : grid
        guard pose != lastBehaviorPose else { return }
        lastBehaviorPose = pose

        let look = look, pose = pose
        let size = inflated.size
        let geometry = Self.geometry(look: look, pose: pose, fine: bounds.width > 100)
        let img = FigureRenderer.image(size: size, scale: window?.backingScaleFactor ?? 2, space: window?.colorSpace?.cgColorSpace) {
            FigureRenderer.draw($0, size: size, look: look, geometry: geometry, margin: Self.margin, pose: pose)
        }
        if let img { content.contents = img }
    }

    private var screenFrame: CGRect? {
        guard let w = window else { return nil }
        return w.convertToScreen(convert(bounds, to: nil))
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        lastSignature = ""
        lastBehaviorPose = nil
        tick(now: Date.timeIntervalSinceReferenceDate)
    }

    func tick(now: TimeInterval) {
        effectiveAppearance.performAsCurrentDrawingAppearance { renderTick(now: now) }
    }

    private func renderTick(now: TimeInterval) {
        guard bounds.width > 1, bounds.height > 1 else { return }
        defer { updateTransition(now: now) }
        if let mood { tickBehavior(now: now, mood: mood); return }
        if player == nil || playerShape != look.shape { player = AvatarPlayer(shape: look.shape); playerShape = look.shape }
        guard let player else { return }
        player.setRunning(tickVisible, now: now)
        let dt = min(0.1, max(0, now - lastTick)); lastTick = now
        player.grid = bounds.width > 60 ? 48 : 24
        let frame = player.frame(now: now, state: state, chatOpen: chatOpen, reduceMotion: reduced)

        // Maus: nur beim Darüberfahren drehen sich Augen und Kopf (der Körper dreht mit), sonst zurück zur Mitte.
        var target = CGPoint.zero
        if follow && role == .editor && !reduced, let f = screenFrame {
            PointerTracker.shared.poll(now: now)
            target = hoverArea ? Self.areaVector(pointer: PointerTracker.shared.location, frame: f) : Self.hoverVector(pointer: PointerTracker.shared.location, frame: f)
        }
        let k = reduced ? 1 : 1 - exp(-dt / max(0.01, look.reaction))
        pull.x += (target.x - pull.x) * k
        pull.y += (target.y - pull.y) * k
        if abs(target.x - pull.x) + abs(target.y - pull.y) < 0.005 { pull = target }
        let eyeMoving = pull != target || target != .zero
        var expression = frame.expression
        if pull != .zero {
            expression.v[0] -= pull.y * Self.headReach * look.gaze      // Kopf hoch/runter
            expression.v[1] += pull.x * Self.headReach * look.gaze      // Kopf links/rechts
            expression.v[2] += pull.x * 5 * look.gaze                   // leicht in die Kurve legen
        }
        let eye = CGPoint(x: pull.x * Self.eyeReach * look.gaze, y: pull.y * Self.eyeReach * look.gaze)

        // Bildrate: Bild für Bild bei Bewegung (kleine Figuren mit 30), sonst erst zur nächsten Änderung.
        let fast = frame.blinking ? 1.0 / 60 : 1.0 / player.grid
        interval = frame.moving || eyeMoving ? fast : min(0.5, max(fast, frame.nextChange))

        let sig = "\(look.shape)\(look.hue)\(look.saturation)\(look.eyes?.rawValue ?? "")\(look.accessory)\(look.cheeks)\(look.bodyHex)\(Int(bounds.width))x\(Int(bounds.height))|\(expression.cacheKey)|\(Int((frame.blink * 20).rounded()))|\(Int((eye.x * 4).rounded())),\(Int((eye.y * 4).rounded()))"
        if sig == lastSignature { return }
        lastSignature = sig
        let look = look
        let size = inflated.size
        let geometry = AvatarEngine.shared.geometry(shape: look.shape, expression: expression, blink: frame.blink, eye: eye, fine: bounds.width > 100)
        let img = FigureRenderer.image(size: size, scale: window?.backingScaleFactor ?? 2, space: window?.colorSpace?.cgColorSpace) {
            FigureRenderer.draw($0, size: size, look: look, geometry: geometry, margin: Self.margin)
        }
        if let img { content.contents = img }
    }

    private func updateTransition(now: TimeInterval) {
        guard let start = transitionStart else { return }
        let opacity = FigureMode.transitionOpacity(elapsed: now - start, reduceMotion: reduced)
        CATransaction.begin(); CATransaction.setDisableActions(true)
        previousContent.opacity = Float(opacity)
        if opacity == 0 { previousContent.contents = nil; transitionStart = nil }
        CATransaction.commit()
        if opacity > 0 { interval = min(interval, 1.0 / 60) }
    }

}

extension EnvironmentValues {
    // Screenshots und Selbsttest zeichnen statische Figuren (Layer-Inhalt lässt sich nicht ins Bitmap rendern).
    @Entry var figuresStatic = false
    // Orbis, deren Chat gerade offen ist (Direktchat, Gruppenmitglieder, Lauf): sie sind im Zustand Ruhig überall lebhafter (Blick wandert).
    @Entry var orbiOpenBots: Set<String> = []
    // Zeiger steht im Chat-Kopf (Pille): nur dann schaut der Avatar dort zur Maus.
    @Entry var headerHover = false
}

// Lebende Figur: Augen folgen dem Zeiger, blinzelt, wippt beim Arbeiten (Web-Werte, FigureMotion).
// live = ganzer Körper folgt (Seitenleiste), sonst nur die Pupillen.
struct OrbiFigure: View {
    let look: OrbiLook
    var state: OrbiState = .calm
    var live = false
    var follow = true
    var hoverArea = false
    var role = FigureRole.editor
    @Environment(\.accessibilityReduceMotion) private var reduced
    @Environment(\.figuresStatic) private var isStatic
    var chatOpen = false

    var body: some View {
        if isStatic {
            Canvas { ctx, size in
                ctx.withCGContext { FigureRenderer.drawNeutral($0, size: size, look: look) }
            }
        } else {
            LiveFigure(look: look, state: state, reduced: reduced, live: live, chatOpen: chatOpen, follow: follow, hoverArea: hoverArea, role: role)
        }
    }

    private struct LiveFigure: NSViewRepresentable {
        let look: OrbiLook
        let state: OrbiState
        let reduced: Bool
        let live: Bool
        let chatOpen: Bool
        let follow: Bool
        let hoverArea: Bool
        let role: FigureRole
        func makeNSView(context: Context) -> FigureLayerView { FigureLayerView(frame: .zero) }
        func updateNSView(_ view: FigureLayerView, context: Context) {
            view.apply(look: look, state: state, reduceMotion: reduced, live: live, chatOpen: chatOpen, follow: follow, hoverArea: hoverArea, role: role)
        }
    }
}

// Figur eines Orbis. Kein Status-Ring (Web: „Ringe weg“); der Zustand steht als Text daneben und in der Bedienungshilfe.
// live = ganzer Körper folgt dem Zeiger und wippt beim Arbeiten (Web: nur Seitenleiste), sonst folgen nur die Pupillen.
struct OrbiAvatar: View {
    let name: String
    let avatar: String?       // nil = Orbi gelöscht
    let colorHex: String?
    var look: BotLook?
    var state: OrbiState = .calm
    var size: CGFloat = 40
    var live = false
    var follow = true          // Augen folgen der Maus beim Darüberfahren (aus links neben Chat-Nachrichten)
    var hoverArea = false      // Zeile oder Karte unter dem Zeiger: Augen folgen im ganzen Feld
    var botId: String?         // Orbi-Kennung: ist sein Chat offen, gilt er in der Seitenleiste als „ausgewählt“
    var role = FigureRole.message
    @Environment(\.orbiOpenBots) private var openBots
    @Environment(\.headerHover) private var headerHover
    @State private var figureHover = false

    var body: some View {
        Group {
            if let avatar {
                figure(OrbiLook(avatar: avatar, colorHex: colorHex, look: look))
            } else {
                DeletedOrbiAvatar()
            }
        }
        .frame(width: size, height: size)
        .onHover { if role == .panel || role == .empty { figureHover = $0 } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(avatar == nil ? "Gelöschter Orbi" : state == .calm ? name : "\(name), \(state.caption)")
    }

    private func figure(_ look: OrbiLook) -> some View {
        OrbiFigure(look: look, state: state, live: live, follow: follow, hoverArea: role == .header ? headerHover : role == .panel || role == .empty ? figureHover : hoverArea, role: role,
                   chatOpen: botId.map { openBots.contains($0) } ?? false)
    }

}

// Platzhalter für einen Orbi, den es nicht mehr gibt, und für Gruppen ohne Orbis (wie im Web).
struct DeletedOrbiAvatar: View {
    var body: some View {
        Circle()
            .fill(Theme.Palette.muted)
            .overlay {
                GeometryReader { box in
                    Image(systemName: "person.fill.xmark")
                        .resizable().scaledToFit()
                        .frame(width: box.size.width * 0.5, height: box.size.height * 0.5)
                        .foregroundStyle(Theme.Palette.mutedForeground)
                        .position(x: box.size.width / 2, y: box.size.height / 2)
                }
            }
    }
}

// Gruppen-Figur wie components/group-avatar.tsx: so groß wie eine Einzelfigur; 1 voll, 2 nebeneinander überlappend (62 %),
// 3 im Dreieck (54 %), ab 4 Raster 2 × 2 (50 %) mit „+N“; höchstens drei Figuren sichtbar.
struct AvatarStack: View {
    let members: [GroupMember]
    var size: CGFloat = 28
    var live = false
    var role = FigureRole.message
    var hoverArea = false
    private static let layouts: [Int: (size: CGFloat, at: [(CGFloat, CGFloat)])] = [
        1: (1, [(0, 0)]), 2: (0.6675, [(0, 0.16625), (0.3325, 0.16625)]), 3: (0.54, [(0.23, 0), (0, 0.46), (0.46, 0.46)]),
        4: (0.5, [(0, 0), (0.5, 0), (0, 0.5), (0.5, 0.5)]),
    ]

    var body: some View {
        if members.isEmpty {
            DeletedOrbiAvatar().frame(width: size, height: size)
        } else {
            let shown = Array(members.prefix(3))
            let extra = members.count - shown.count
            let layout = Self.layouts[min(4, shown.count + (extra > 0 ? 1 : 0))]!
            let cell = size * layout.size
            ZStack(alignment: .topLeading) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, member in
                    OrbiAvatar(name: member.name ?? member.avatar, avatar: member.avatar, colorHex: member.color, look: member.look, size: cell, live: live, hoverArea: hoverArea, botId: member.id, role: role)
                        .offset(x: size * layout.at[index].0, y: size * layout.at[index].1)
                }
                if extra > 0 {
                    Circle().fill(Theme.Palette.muted)
                        .overlay { Text("+\(extra)").font(Theme.Fonts.geist(cell * 0.45, .semibold)).foregroundStyle(Theme.Palette.mutedForeground) }
                        .frame(width: cell, height: cell)
                        .offset(x: size * layout.at[3].0, y: size * layout.at[3].1)
                }
            }
            .frame(width: size, height: size, alignment: .topLeading)
        }
    }
}
