import CoreGraphics
import Foundation

// Bewegung der Orbis nach dem Artifact „Orbi Zustände“ (Design Orbis, 27.10.2026): Blickziele, Blinzeln, Hüpfen, Drehen, Backflips.
// Reine Rechnung ohne Zeichnen: liefert pro Bild eine Pose. Blick (lx, ly: −1…1, y nach unten) und Augenmaße gehen in die Engine,
// Verschiebung, Neigung und Stauchung legt der Renderer um den ganzen Körper, Drehungen (flipX/flipY) addiert er auf den Kopfwinkel.
// Maße (x, y, Sprunghöhe) stehen im Maß des Artifacts (Kugel Radius 42 von 100); der Renderer rechnet sie auf die Engine-Kugel um.

enum OrbiMood: Equatable, Sendable {
    case idle        // Chat nicht ausgewählt
    case selected    // Chat ausgewählt
    case head        // Figur im Chat-Kopf und im Panel: folgt der Maus, kein Blinzeln (Figma 148:84618, 148:88246)
    case empty       // Leerzustand: wie Kopf, blinzelt alle 2,5–4 s (Figma 148:89425)
    case message     // neben den Nachrichten
    case working, waiting, done
}

enum FigureRole: Sendable { case editor, sidebar, header, message, panel, empty, status }

enum FigureMode {
    static func mood(role: FigureRole, state: OrbiState, chatOpen: Bool) -> OrbiMood? {
        switch role {
        case .editor: nil
        case .message: .message
        case .header, .panel: .head
        case .empty: .empty
        case .status: state == .waiting ? .waiting : state == .working ? .working : .message
        case .sidebar:
            switch state {
            case .calm: chatOpen ? .selected : .idle
            case .working: .working
            case .waiting: .waiting
            case .done: .done
            case .listening, .limit, .error: nil
            }
        }
    }

    static func tracksPointer(role: FigureRole, hoverArea: Bool) -> Bool {
        hoverArea && (role == .sidebar || role == .header || role == .panel || role == .empty)
    }

    static func mouseLook(delta: CGPoint, width: CGFloat, enhanced: Bool) -> CGPoint {
        let distance = hypot(delta.x, delta.y)
        guard distance > 0.5, width > 0 else { return .zero }
        let strength = tanh(distance / (width * 1.4)) * (enhanced ? 1.5 : 1)
        return CGPoint(x: delta.x / distance * strength, y: delta.y / distance * strength)
    }

    static func transitionOpacity(elapsed: TimeInterval, reduceMotion: Bool) -> Double {
        guard !reduceMotion else { return 0 }
        let progress = min(1, max(0, elapsed / Theme.Motion.figureTransition))
        return 1 - progress * progress * (3 - 2 * progress)
    }
}

struct OrbiSpark: Equatable, Sendable {
    var x: Double, y: Double, vx: Double, vy: Double
    var life = 0.0
    var span: Double
    var scale: Double
    var color: Int
}

struct OrbiPose: Equatable, Sendable {
    var lx = 0.0, ly = 0.0
    var tilt = 0.0, rot = 0.0
    var blink = 0.0           // 0 offen … 1 zu
    var es = 1.0              // Augengröße
    var x = 0.0, y = 0.0
    var sx = 1.0, sy = 1.0, sc = 1.0
    var shine = 0.0           // Glanzpunkt in den Augen
    var dot = 0.0             // blauer Punkt (fertig), 0 … 1
    var flipX = 0.0, flipY = 0.0   // Drehung in sich (Grad), nicht geglättet: 360 Grad = Ausgangslage
    var badge = false         // oranger Kreis (wartet)
    var sparks: [OrbiSpark] = []
}

@MainActor
final class OrbiBehavior {
    private(set) var pose = OrbiBehavior.still(.idle)
    private(set) var mood: OrbiMood = .idle
    // Nichts bewegt sich mehr: der Takt darf bis zum nächsten Ereignis ruhen.
    private(set) var settled = false
    private(set) var untilNextEvent = 0.5

    private enum Spin { case flip, turn }
    private struct Jump { var start: Double; var height: Double; var duration: Double; var spin: Spin?; var dir: Double }

    // Blickpositionen „ausgewählt“: zehn leicht verschiedene.
    private static let selectedGaze: [(Double, Double)] = [
        (-0.45, 0), (0.4, 0.05), (0, 0), (-0.25, -0.12), (0.3, -0.1), (-0.55, 0.08), (0.5, 0), (-0.15, 0.12), (0.15, -0.05), (-0.35, -0.05),
    ]
    private static let sparkColors = 5
    private static let workCycle = 20.0   // Arbeiten: Schleifenlänge in Sekunden

    private var clock: Double?          // Beginn des Zustands (erst beim ersten sichtbaren Bild)
    private var last = 0.0
    private var next = 0.0
    private var previousIndex = -1
    private var tx = 0.0, ty = 0.0
    private var nextBlink = 0.0
    private var blinkStart = -1.0
    private var jump: Jump?
    private var nextSpin = 0.0
    private var nextHop = 0.0
    private var stage = 0
    private var shining = false
    private var workEs = 1.0
    private var gazeFrom = OrbiPose()
    private var gazeStart = 0.0
    private var gazeDuration = 0.0
    private var wasLookingAtMouse = false
    private var headReturnStart: Double?
    private var headReturnFrom = OrbiPose()
    private var pausedAt: Double?
    private var vlx = 0.0, vly = 0.0, vtilt = 0.0   // Geschwindigkeit der Blick-Feder

    // Consti 05.11. (Video 2/3): Blick folgt als Feder – fast sofort da, kurz nachschwingen, nicht weich nachziehen.
    static let followResponse = 0.15, followDamping = 0.75   // Maus (Kopf, Panel, Seitenleiste)
    static let dartResponse = 0.14, dartDamping = 0.7        // Augen-Sprünge beim Arbeiten
    static let stretchAmount = 0.06                          // Streckung Richtung Zeiger, solange er seitlich steht

    // Gedämpfte Feder in kleinen Schritten (stabil auch bei 20-Hz-Takt).
    private static func spring(_ value: inout Double, _ velocity: inout Double, to target: Double, dt: Double, response: Double, damping: Double) {
        let omega = 2 * Double.pi / response
        var rest = dt
        while rest > 1e-9 {
            let h = min(rest, 1.0 / 240)
            velocity += (omega * omega * (target - value) - 2 * damping * omega * velocity) * h
            value += velocity * h
            rest -= h
        }
    }

    // Blick (lx, ly, tilt) per Feder zum Ziel; liefert Restabstand plus Tempo (≈ 0 = ruhig).
    @discardableResult
    private func springGaze(lx: Double, ly: Double, tilt: Double, dt: Double, response: Double, damping: Double) -> Double {
        Self.spring(&pose.lx, &vlx, to: lx, dt: dt, response: response, damping: damping)
        Self.spring(&pose.ly, &vly, to: ly, dt: dt, response: response, damping: damping)
        Self.spring(&pose.tilt, &vtilt, to: tilt, dt: dt, response: response, damping: damping)
        return abs(lx - pose.lx) + abs(ly - pose.ly) + abs(tilt - pose.tilt) / 5 + abs(vlx) * 0.05 + abs(vly) * 0.05 + abs(vtilt) * 0.01
    }

    // Squish/Stretch nach Zeigerrichtung: seitlich breiter, oben/unten höher (gehalten, solange der Zeiger dort steht).
    private static func stretch(_ m: CGPoint) -> (sx: Double, sy: Double) {
        let ax = min(1, abs(m.x)), ay = min(1, abs(m.y))
        return (1 + stretchAmount * ax - stretchAmount * 0.5 * ay, 1 + stretchAmount * ay - stretchAmount * 0.5 * ax)
    }
    private func applyStretch(_ m: CGPoint, dt: Double) {
        let target = Self.stretch(m), k = 1 - exp(-30 * dt)
        pose.sx += (target.sx - pose.sx) * k; pose.sy += (target.sy - pose.sy) * k
    }
    private let random: (Double, Double) -> Double

    init(random: @escaping (Double, Double) -> Double = { Double.random(in: $0...$1) }) {
        self.random = random
    }

    func setMood(_ new: OrbiMood) {
        guard new != mood else { return }
        mood = new
        clock = nil; next = 0; jump = nil; stage = 0; shining = false; nextSpin = 0; previousIndex = -1
        vlx = 0; vly = 0; vtilt = 0
        pose.sparks.removeAll()
        pose.flipX = 0; pose.flipY = 0
        headReturnStart = nil
        gazeDuration = 0; wasLookingAtMouse = false
    }

    private func rnd(_ a: Double, _ b: Double) -> Double { random(a, b) }
    private func pick<T>(_ a: [T]) -> T { a[Int.random(in: 0..<a.count)] }
    private func startJump(_ h: Double, _ duration: Double, spin: Spin? = nil, dir: Double = 1, now: Double) {
        jump = Jump(start: now, height: h, duration: duration, spin: spin, dir: dir)
    }

    private func settleBody(dt: Double) -> Bool {
        let k = 1 - exp(-8 * dt)
        var difference = 0.0
        func move(_ value: inout Double, to target: Double) {
            difference += abs(value - target)
            value += (target - value) * k
        }
        move(&pose.rot, to: 0); move(&pose.blink, to: 0); move(&pose.es, to: 1)
        move(&pose.x, to: 0); move(&pose.y, to: 0)
        move(&pose.sx, to: 1); move(&pose.sy, to: 1); move(&pose.sc, to: 1)
        move(&pose.shine, to: 0); move(&pose.dot, to: 0)
        pose.badge = false
        return difference < 0.001
    }

    private func spawnStar() {
        let a = rnd(0, 6.28), d = rnd(30, 48)
        pose.sparks.append(OrbiSpark(x: 50 + cos(a) * d, y: 50 + sin(a) * d * 0.9, vx: cos(a) * rnd(8, 24), vy: sin(a) * rnd(8, 24) - 14,
                                     span: rnd(0.8, 1.4), scale: rnd(0.7, 1.3), color: Int.random(in: 0..<Self.sparkColors)))
    }

    func setRunning(_ run: Bool, now: Double) {
        if !run {
            if pausedAt == nil { pausedAt = now }
            return
        }
        guard let pausedAt else { return }
        let duration = max(0, now - pausedAt)
        func shifted(_ time: Double) -> Double { time > 0 ? time + duration : time }
        clock = clock.map { $0 + duration }
        last = shifted(last); next = shifted(next); nextBlink = shifted(nextBlink)
        blinkStart = shifted(blinkStart); nextSpin = shifted(nextSpin); nextHop = shifted(nextHop)
        gazeStart = shifted(gazeStart)
        headReturnStart = headReturnStart.map { $0 + duration }
        if var current = jump { current.start += duration; jump = current }
        self.pausedAt = nil
    }

    // Ein Bild. `run` = false: nur die aktuelle Pose zeigen, ohne Zeit zu verbrauchen (Fenster verdeckt, App im Hintergrund).
    // `mouse` = Blickrichtung zur Maus (nur gesetzt, wenn der Zeiger im eigenen Feld steht).
    @discardableResult
    func step(now: Double, run: Bool, mouse: CGPoint?) -> OrbiPose {
        setRunning(run, now: now)
        guard run else { return pose }
        if mood == .message {
            pose = Self.still(.message)
            settled = true; untilNextEvent = 0.5
            return pose
        }
        if mood == .head || mood == .empty {
            let dt = min(0.05, max(0.001, now - last)); last = now
            let bodySettled = settleBody(dt: dt)
            if clock == nil { clock = now; nextBlink = now + rnd(2.5, 4) }
            if let mouse {
                headReturnStart = nil
                springGaze(lx: mouse.x, ly: mouse.y, tilt: mouse.x * 5, dt: dt, response: Self.followResponse, damping: Self.followDamping)
                applyStretch(mouse, dt: dt)
                settled = false
            } else {
                vlx = 0; vly = 0; vtilt = 0
                let target = Self.still(.idle)
                if headReturnStart == nil && (pose.lx != target.lx || pose.ly != target.ly || pose.tilt != target.tilt) {
                    headReturnStart = now; headReturnFrom = pose
                }
                if let start = headReturnStart {
                    let progress = min(1, max(0, (now - start) / Theme.Motion.figureGazeReturn))
                    let eased = progress * progress * (3 - 2 * progress)
                    pose.lx = headReturnFrom.lx + (target.lx - headReturnFrom.lx) * eased
                    pose.ly = headReturnFrom.ly + (target.ly - headReturnFrom.ly) * eased
                    pose.tilt = headReturnFrom.tilt + (target.tilt - headReturnFrom.tilt) * eased
                    if progress == 1 {
                        pose.lx = target.lx; pose.ly = target.ly; pose.tilt = target.tilt
                        headReturnStart = nil
                    }
                }
                settled = headReturnStart == nil && bodySettled
            }
            // Blinzeln nur im Leerzustand (A2); Kopf und Panel bleiben offen.
            guard mood == .empty else {
                pose.blink = 0
                untilNextEvent = 0.5
                return pose
            }
            if now >= nextBlink { blinkStart = now; nextBlink = now + rnd(2.5, 4) }
            let blinkTime = now - blinkStart
            pose.blink = blinkStart >= 0 && blinkTime < 0.17 ? sin(blinkTime / 0.17 * .pi) : 0
            if blinkStart >= 0 && blinkTime < 0.17 { settled = false }
            untilNextEvent = max(0.03, min(0.5, nextBlink - now))
            return pose
        }
        if mood == .idle {
            let dt = min(0.05, max(0.001, now - last)); last = now
            let bodySettled = settleBody(dt: dt)
            let target = mouse.map { point -> OrbiPose in
                var p = OrbiPose(); p.lx = point.x; p.ly = point.y; p.tilt = point.x * 5
                return p
            } ?? Self.still(.idle)
            let rest = springGaze(lx: target.lx, ly: target.ly, tilt: target.tilt, dt: dt, response: Self.followResponse, damping: Self.followDamping)
            if let mouse { applyStretch(mouse, dt: dt) }
            settled = mouse == nil && bodySettled && rest < 0.001
            if settled { pose = target; vlx = 0; vly = 0; vtilt = 0 }
            untilNextEvent = 0.5
            return pose
        }
        let dt = min(0.05, max(0.001, now - last)); last = now
        if clock == nil { clock = now; nextBlink = now + rnd(2.5, 4); nextSpin = now + 18; nextHop = now + 8 }
        let t = now - (clock ?? now)

        var lx = 0.0, ly = 0.0, tilt = 0.0, rot = 0.0, blink = 0.0, es = 1.0
        var x = 0.0, y = 0.0, sx = 1.0, sy = 1.0, sc = 1.0, shine = 0.0, dot = 0.0
        var k = 10.0
        var mouseLook = false
        var interpolatedGaze = false
        var gazeMoving = false
        var continuous = false
        var sprung = false   // Blick läuft über die Feder statt über k

        if let m = mouse, mood == .idle || mood == .selected || mood == .head {
            lx = m.x; ly = m.y; tilt = lx * 5; k = 14; mouseLook = true
            (sx, sy) = Self.stretch(m)
            wasLookingAtMouse = true
            sprung = true
        }
        if !mouseLook {
            if wasLookingAtMouse { next = 0; wasLookingAtMouse = false; vlx = 0; vly = 0; vtilt = 0 }
            switch mood {
            case .idle:
                lx = -0.8; ly = -0.85; tilt = 9; k = 6
            case .selected, .head, .empty:
                if gazeDuration == 0 || now >= next {
                    var i = min(Self.selectedGaze.count - 1, Int(rnd(0, Double(Self.selectedGaze.count))))
                    if i == previousIndex { i = (i + 1) % Self.selectedGaze.count }
                    previousIndex = i
                    tx = rnd(0.2, 0.35) * (i.isMultiple(of: 2) ? 1 : -1); ty = 0
                    gazeFrom = pose; gazeStart = now
                    gazeDuration = rnd(Theme.Motion.selectedGazeDuration.lowerBound, Theme.Motion.selectedGazeDuration.upperBound)
                    next = now + rnd(Theme.Motion.gazeInterval.lowerBound, Theme.Motion.gazeInterval.upperBound)
                }
                let progress = min(1, max(0, (now - gazeStart) / gazeDuration))
                let eased = progress * progress * (3 - 2 * progress)
                lx = gazeFrom.lx + (tx - gazeFrom.lx) * eased
                ly = gazeFrom.ly + (ty - gazeFrom.ly) * eased
                tilt = gazeFrom.tilt + (tx * 3 - gazeFrom.tilt) * eased
                interpolatedGaze = true; gazeMoving = progress < 1
            case .message:
                if now > next { tx = pick([0, 0, 0.3, -0.3, 0, 0.2, -0.2]); next = now + rnd(1.1, 2.8) }
                lx = tx; k = 7
            case .working:
                continuous = true
                if gazeDuration == 0 || now >= next {
                    tx = rnd(-0.9, 0.9); ty = rnd(-0.6, 0.6)
                    workEs = rnd(0.94, 1.10)
                    gazeFrom = pose; gazeStart = now
                    gazeDuration = rnd(Theme.Motion.workingGazeDuration.lowerBound, Theme.Motion.workingGazeDuration.upperBound)
                    next = now + rnd(Theme.Motion.gazeInterval.lowerBound, Theme.Motion.gazeInterval.upperBound)
                }
                // Augen-Sprung: Feder (schnappt hin, schwingt kurz nach) statt weichem Ease-in-out.
                lx = tx; ly = ty; tilt = 0
                sprung = true
                es = workEs
                y = sin(t * 2 * .pi / 1.67); k = 10
                // 20-s-Schleife (A4, Figma 147:62578): bei 8 s Sprung mit Drehung, bei 18 s Rückwärtssalto, dann von vorn.
                if jump == nil, now > nextSpin {
                    startJump(7, 0.95, spin: .flip, now: now)
                    repeat { nextSpin += Self.workCycle } while nextSpin <= now
                } else if jump == nil, now > nextHop {
                    startJump(7, 0.95, spin: .turn, now: now)
                    repeat { nextHop += Self.workCycle } while nextHop <= now
                }
            case .waiting:
                continuous = true
                let phase = t * 2 * .pi / 6.7
                x = sin(phase) * 5; tilt = sin(phase) * 2.5
                lx = cos(phase) * 0.9; ly = 0; k = 5
            case .done:
                continuous = true
                if t < 2.3 {
                    k = 16
                    switch stage {
                    case 0:
                        sy = 0.78; sx = 1.18
                        if t >= 0.2 { stage = 1; startJump(26, 0.62, spin: .flip, now: now) }
                    case 1:
                        if jump == nil {
                            sy = 0.8; sx = 1.16
                            if t >= 1.0 { stage = 2; startJump(32, 0.75, spin: .flip, now: now) }
                        }
                    case 2:
                        if jump == nil { stage = 3; for _ in 0..<18 { spawnStar() } }
                    default:
                        tilt = sin((t - 1.8) * 14) * 10
                    }
                } else {
                    if !shining { shining = true; next = 0; nextHop = now + rnd(Theme.Motion.doneHopInterval.lowerBound, Theme.Motion.doneHopInterval.upperBound) }
                    shine = 1; es = 1.2; dot = 1; k = 10
                    if now > next { tx = pick([-0.9, 0.9, -0.5, 0.5, 0]); ty = pick([-0.2, 0, 0.1]); next = now + rnd(1.2, 2.5) }
                    lx = tx; ly = ty; tilt = lx * 5
                    if jump == nil, now > nextHop { startJump(9, 0.42, now: now); nextHop = now + rnd(Theme.Motion.doneHopInterval.lowerBound, Theme.Motion.doneHopInterval.upperBound) }
                }
            }
        }

        // Blinzeln (nicht neben Nachrichten, beim Warten und Feiern): selten doppelt
        if mood == .selected || mood == .head || mood == .working {
            if now > nextBlink {
                blinkStart = now
                let interval = rnd(2.5, 4)
                nextBlink = now + interval
            }
            if blinkStart >= 0, now - blinkStart < 0.17 { blink = sin((now - blinkStart) / 0.17 * .pi) }
        }

        // Sprung (Hüpfer, Drehung in sich, Backflip)
        var flipX = 0.0, flipY = 0.0
        var jumping = false
        if let j = jump {
            let u = (now - j.start) / j.duration
            if u >= 1 { jump = nil }
            else {
                jumping = true
                y = -j.height * 4 * u * (1 - u)
                let squash = u < 0.12 ? (1 - u / 0.12) * 0.14 : (u > 0.88 ? (u - 0.88) / 0.12 * 0.14 : 0)
                let mid = u > 0.12 && u < 0.88
                sy = 1 - squash + (mid ? 0.06 : 0); sx = 1 + squash - (mid ? 0.04 : 0)
                if let spin = j.spin {
                    let angle = min(1, u * 1.05) * 360 * j.dir
                    if spin == .flip { flipX = angle } else { flipY = angle }
                }
            }
        }

        // Glätten: Blinzeln, Stauchung und Punkt mit eigenem Tempo, der Rest mit k
        func approach(_ v: inout Double, _ target: Double, _ rate: Double) { v += (target - v) * (1 - exp(-rate * dt)) }
        var delta = 0.0
        func track(_ v: inout Double, _ target: Double, _ rate: Double) { delta += abs(target - v); approach(&v, target, rate) }
        if sprung {
            let response = mood == .working ? Self.dartResponse : Self.followResponse
            let damping = mood == .working ? Self.dartDamping : Self.followDamping
            let rest = springGaze(lx: lx, ly: ly, tilt: tilt, dt: dt, response: response, damping: damping)
            delta += rest; gazeMoving = rest > 0.002
        } else if interpolatedGaze {
            pose.lx = lx; pose.ly = ly; pose.tilt = tilt
        } else {
            track(&pose.lx, lx, k); track(&pose.ly, ly, k); track(&pose.tilt, tilt, k)
        }
        track(&pose.rot, rot, k); track(&pose.es, es, k)
        track(&pose.x, x, k); track(&pose.sc, sc, k); track(&pose.shine, shine, k)
        track(&pose.blink, blink, 60); track(&pose.dot, dot, 12)
        track(&pose.sx, sx, 30); track(&pose.sy, sy, 30)
        if jumping { pose.y = y; delta += 1 } else { track(&pose.y, y, k) }
        pose.flipX = flipX; pose.flipY = flipY
        pose.badge = mood == .waiting

        // Funken
        if !pose.sparks.isEmpty {
            var kept: [OrbiSpark] = []
            for var s in pose.sparks {
                s.life += dt
                if s.life >= s.span { continue }
                s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 26 * dt
                kept.append(s)
            }
            pose.sparks = kept
        }

        let blinking = blinkStart >= 0 && now - blinkStart < 0.17
        settled = !continuous && !gazeMoving && !jumping && !blinking && pose.sparks.isEmpty && delta < 0.002
        untilNextEvent = max(0.03, min(next > 0 ? next - now : 0.5, nextBlink - now, nextSpin - now))
        return pose
    }

    // Nur für Tests: sofort eine Drehung in sich auslösen.
    func forceSpin(turn: Bool, now: Double) { startJump(7, 0.95, spin: turn ? .turn : .flip, now: now) }

    // Ruhebild ohne Bewegung (Bewegung reduzieren): Mitte, nur die Zeichen des Zustands bleiben.
    static func still(_ mood: OrbiMood) -> OrbiPose {
        var p = OrbiPose()
        if mood == .idle { p.lx = -0.8; p.ly = -0.85; p.tilt = 9 }
        p.badge = mood == .waiting
        p.dot = mood == .done ? 1 : 0
        return p
    }
}
