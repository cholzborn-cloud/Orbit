import CoreGraphics
import Foundation

// Spielt die Animationen des Avatar-Labs ab (Ablauf wie browserRuntime des Labs: je Schritt Übergang, dann Halten, Blinzeln nach Zeitplan)
// und wählt je Zustand das Programm: Abschnitte mit Wiederholungen, zwischen allen Wechseln weiches Überblenden.
struct AvatarProgram: Equatable {
    struct Segment: Equatable {
        let animation: String
        var loops: Int? = nil           // nil = ohne Ende
        var seconds: Double? = nil      // höchstens so lange (ab Beginn des Abschnitts)
    }
    var key: String
    var segments: [Segment]

    // Chat zu: Position 1 (Kopf rechts geneigt, Blick links oben, atmet). Chat offen: der Blick wandert.
    static func make(state: OrbiState, chatOpen: Bool) -> AvatarProgram {
        let key = "\(state)\(state == .calm && chatOpen ? "-open" : "")"
        switch state {
        case .calm: return AvatarProgram(key: key, segments: [.init(animation: chatOpen ? "calm-3" : "calm-1")])
        case .listening: return AvatarProgram(key: key, segments: [.init(animation: "listen-1")])
        case .working: return AvatarProgram(key: key, segments: [.init(animation: "work-1")])
        case .waiting: return AvatarProgram(key: key, segments: [.init(animation: "wait-1", seconds: 30), .init(animation: "wait-2")])
        case .done: return AvatarProgram(key: key, segments: [.init(animation: "done-1", loops: 1), .init(animation: "done-3")])
        case .limit: return AvatarProgram(key: key, segments: [.init(animation: "limit-1")])
        case .error: return AvatarProgram(key: key, segments: [.init(animation: "error-1", loops: 3), .init(animation: "error-5")])
        }
    }
}

struct AvatarFrame {
    var expression: AvatarExpression
    var blink: Double
    var moving: Bool             // Übergang oder Blinzeln läuft: Bild für Bild zeichnen
    var blinking = false         // Blinzeln läuft (feineres Raster: sonst schließen sich die Augen nicht ganz)
    var nextChange: Double       // Sekunden bis zur nächsten Änderung (für die Bildrate im Halten)
}

@MainActor
final class AvatarPlayer {
    static let crossfade = 0.28    // Zustandswechsel: zügig, mit schnellem Anlauf
    private let def: AvatarDefinition
    private var program: AvatarProgram?
    private var segment = 0
    private var loopsDone = 0
    private var segmentStart = 0.0
    private var stepIndex = 0
    private var inTransition = true
    private var phaseStart = 0.0
    private var from: AvatarExpression
    private var to: AvatarExpression
    private var transition = 0.0
    private var kind = AvatarAnimation.Kind.smooth
    private var current: AvatarExpression
    private var nextBlink = 0.0
    private var blinkStart = -1.0
    private var pausedAt: Double?
    private var rng = SystemRandomNumberGenerator()
    // Zeitraster der Animation (Bilder pro Sekunde): gleiche Zeitpunkte je Durchlauf, damit der Zwischenspeicher der Engine trifft.
    var grid = 24.0

    init(shape: OrbiShape) {
        def = AvatarEngine.shared.definition(shape)
        from = def.neutral; to = def.neutral; current = def.neutral
    }

    private var animation: AvatarAnimation? { program.flatMap { def.animations[$0.segments[segment].animation] } }

    static func ease(_ p: Double, _ kind: AvatarAnimation.Kind) -> Double {
        switch kind {
        case .smooth: return p * p * (3 - 2 * p)
        case .snappy: return 1 - pow(1 - p, 3)
        case .spring: return 1 - exp(-6 * p) * cos(8 * p)
        }
    }

    func setRunning(_ run: Bool, now: Double) {
        if !run {
            if pausedAt == nil { pausedAt = now }
            return
        }
        guard let pausedAt else { return }
        let elapsed = max(0, now - pausedAt)
        if program != nil {
            segmentStart += elapsed; phaseStart += elapsed; nextBlink += elapsed
            if blinkStart >= 0 { blinkStart += elapsed }
        }
        self.pausedAt = nil
    }

    func frame(now time: Double, state: OrbiState, chatOpen: Bool, reduceMotion: Bool) -> AvatarFrame {
        let now = pausedAt ?? time
        let wanted = AvatarProgram.make(state: state, chatOpen: chatOpen)
        if wanted.key != program?.key { start(wanted, now: now) }
        guard let anim = animation, !anim.steps.isEmpty else { return AvatarFrame(expression: current, blink: 1, moving: false, blinking: false, nextChange: 1) }
        if reduceMotion {
            let rest = def.expressions[anim.steps[0].expression] ?? def.neutral
            return AvatarFrame(expression: rest, blink: 1, moving: false, blinking: false, nextChange: 5)
        }
        advance(now: now)
        guard let anim = animation else { return AvatarFrame(expression: current, blink: 1, moving: false, blinking: false, nextChange: 1) }
        // Ausdruck
        var moving = false
        var change = 1.0
        if inTransition {
            let elapsed = ((now - phaseStart) * grid).rounded() / grid
            let p = transition <= 0 ? 1 : min(1, max(0, elapsed / transition))
            current = AvatarExpression.lerp(from, to, Self.ease(p, kind))
            moving = p < 1
            change = max(0, transition - (now - phaseStart))
        } else {
            current = to
            change = max(0, anim.steps[stepIndex].hold - (now - phaseStart))
        }
        // Blinzeln (Verlauf wie im Lab: 42 % zu, 58 % auf)
        var blink = 1.0, blinking = false
        if anim.blink.enabled {
            if now >= nextBlink && blinkStart < 0 { blinkStart = nextBlink }
            if blinkStart >= 0 {
                let p = min(1, max(0, ((now - blinkStart) * 60).rounded() / 60 / anim.blink.duration))
                if p <= 0.42 { let c = p / 0.42; blink = 1 - c * c } else { let o = (p - 0.42) / 0.58; blink = 1 - pow(1 - o, 2) }
                if p >= 1 {
                    blinkStart = -1; blink = 1
                    nextBlink = now + anim.blink.minInterval + Double.random(in: 0...(anim.blink.maxInterval - anim.blink.minInterval), using: &rng)
                } else { moving = true; blinking = true }
            } else { change = min(change, max(0, nextBlink - now)) }
        }
        return AvatarFrame(expression: current, blink: blink, moving: moving, blinking: blinking, nextChange: change)
    }

    // Neues Programm: aus der aktuellen Pose weich in den ersten Schritt (Beim allerersten Mal ohne Übergang).
    private func start(_ wanted: AvatarProgram, now: Double) {
        let first = program == nil
        program = wanted
        segment = 0; loopsDone = 0; segmentStart = now; stepIndex = 0
        guard let anim = animation, let step = anim.steps.first else { return }
        from = current
        to = def.expressions[step.expression] ?? def.neutral
        if first { from = to; current = to }
        transition = first ? 0 : Self.crossfade; kind = .snappy
        inTransition = true; phaseStart = now
        scheduleBlink(now: now, initial: true)
    }

    private func scheduleBlink(now: Double, initial: Bool) {
        blinkStart = -1
        guard let b = animation?.blink, b.enabled else { return }
        nextBlink = now + (initial ? b.initial : b.minInterval)
    }

    private func advance(now: Double) {
        guard let program else { return }
        var guardCount = 64
        while guardCount > 0 {
            guardCount -= 1
            guard let anim = animation else { return }
            let step = anim.steps[stepIndex]
            let duration = inTransition ? transition : step.hold
            if now < phaseStart + duration { return }
            if now > phaseStart + duration + 60 { phaseStart = now - duration }   // lange Pause: nicht aufholen
            phaseStart += duration
            if inTransition { inTransition = false; continue }
            // nächster Schritt
            var next = stepIndex + 1
            if next >= anim.steps.count {
                next = 0; loopsDone += 1
                let seg = program.segments[segment]
                let loopsOver = seg.loops.map { loopsDone >= $0 } ?? false
                let timeOver = seg.seconds.map { phaseStart - segmentStart >= $0 } ?? false
                if (loopsOver || timeOver) && segment + 1 < program.segments.count {
                    segment += 1; loopsDone = 0; segmentStart = phaseStart
                    scheduleBlink(now: phaseStart, initial: true)
                }
            } else if let limit = program.segments[segment].seconds, phaseStart - segmentStart >= limit, segment + 1 < program.segments.count {
                segment += 1; loopsDone = 0; segmentStart = phaseStart; next = 0
                scheduleBlink(now: phaseStart, initial: true)
            }
            guard let animNow = animation, animNow.steps.indices.contains(next) else { return }
            stepIndex = next
            let s = animNow.steps[next]
            from = to
            to = def.expressions[s.expression] ?? def.neutral
            transition = s.transition; kind = s.kind
            inTransition = true
        }
    }
}
