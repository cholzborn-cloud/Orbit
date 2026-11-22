import CoreGraphics
import Foundation
import JavaScriptCore

// Die Figuren zeichnet die Engine des Avatar-Labs (3D-Körper und Augen, projiziert auf 2D), eingebettet als JavaScript (AvatarEngineSource)
// und mit JavaScriptCore ausgeführt: dieselbe Rechnung wie auf der Website. Hier liegen Ausdrücke (Kopfdrehung, Augen, Nähe),
// die Daten je Avatar und der Zugriff auf die Engine.

// 15 Zahlen je Ausdruck, Reihenfolge wie in AvatarAnimData.
struct AvatarExpression: Equatable, Sendable {
    static let fields = ["headX", "headY", "headZ", "widthLeft", "widthRight", "heightLeft", "heightRight", "spacing",
                         "positionXLeft", "positionXRight", "positionYLeft", "positionYRight", "leftAngle", "rightAngle", "perspective"]
    // Winkel (Grad) laufen auf dem kürzesten Weg: Kopf x, y, z und Augenwinkel.
    static let angleIndices: Set<Int> = [0, 1, 2, 12, 13]
    var v: [Double]

    static func lerp(_ a: AvatarExpression, _ b: AvatarExpression, _ t: Double) -> AvatarExpression {
        var out = a.v
        for i in out.indices {
            var target = b.v[i]
            if angleIndices.contains(i) {
                while target - a.v[i] > 180 { target -= 360 }
                while target - a.v[i] < -180 { target += 360 }
            }
            out[i] = a.v[i] + (target - a.v[i]) * t
        }
        return AvatarExpression(v: out)
    }

    // Gerundet (Zwischenspeicher der Engine): Winkel und Maße auf Achtel, Nähe auf Tausendstel.
    var cacheKey: String { v.enumerated().map { i, x in String(Int((x * (i == 14 ? 1000 : 8)).rounded())) }.joined(separator: ",") }
}

struct AvatarAnimation: Sendable {
    enum Kind: String, Sendable { case smooth, snappy, spring }
    struct Step: Sendable { let expression: String; let hold: Double; let transition: Double; let kind: Kind }   // Sekunden
    struct Blink: Sendable { let enabled: Bool; let initial: Double; let minInterval: Double; let maxInterval: Double; let duration: Double }
    let steps: [Step]
    let blink: Blink
}

struct AvatarDefinition: @unchecked Sendable {
    let surface: Any
    let bodyNodes: Any
    let expressions: [String: AvatarExpression]
    let animations: [String: AvatarAnimation]

    var neutral: AvatarExpression { expressions["expression-neutral"]! }

    init?(json: String) {
        guard let root = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
              let surface = root["surface"], let nodes = root["bodyNodes"],
              let exprs = root["expressions"] as? [String: [Double]], let anims = root["animations"] as? [String: [String: Any]] else { return nil }
        self.surface = surface
        self.bodyNodes = nodes
        expressions = exprs.mapValues { AvatarExpression(v: $0) }
        var parsed: [String: AvatarAnimation] = [:]
        for (key, a) in anims {
            guard let b = a["blink"] as? [String: Any], let s = a["steps"] as? [[Any]] else { continue }
            let blink = AvatarAnimation.Blink(
                enabled: b["enabled"] as? Bool ?? false, initial: (b["initialDelayMs"] as? Double ?? 2000) / 1000,
                minInterval: (b["minIntervalMs"] as? Double ?? 3000) / 1000, maxInterval: (b["maxIntervalMs"] as? Double ?? 5000) / 1000,
                duration: (b["durationMs"] as? Double ?? 240) / 1000)
            let steps = s.compactMap { r -> AvatarAnimation.Step? in
                guard r.count == 4, let e = r[0] as? String, let h = r[1] as? Double, let t = r[2] as? Double, let k = r[3] as? String else { return nil }
                return AvatarAnimation.Step(expression: e, hold: h / 1000, transition: t / 1000, kind: AvatarAnimation.Kind(rawValue: k) ?? .smooth)
            }
            parsed[key] = AvatarAnimation(steps: steps, blink: blink)
        }
        animations = parsed
    }
}

// Umrisse eines Bildes im Raum der Engine (Mitte 0, x nach rechts, y nach unten, etwa ±150).
struct AvatarGeometry {
    var back: [CGPath] = [], front: [CGPath] = []
    var head: CGPath = CGMutablePath(), left: CGPath = CGMutablePath(), right: CGPath = CGMutablePath()
    var leftVisible = true, rightVisible = true
    var blink = 1.0
}

@MainActor
final class AvatarEngine {
    static let shared = AvatarEngine()
    // Zwei Engines: genau (große Figuren, Editor) und schnell (halbe Ring-Stützpunkte, für Figuren bis ca. 100 pt, kaum sichtbar anders).
    private var contexts: [Bool: JSContext] = [:]
    private var definitions: [OrbiShape: AvatarDefinition] = [:]
    private var cache: [String: AvatarGeometry] = [:]

    private func context(fine: Bool) -> JSContext {
        if let c = contexts[fine] { return c }
        let c = JSContext()!
        c.exceptionHandler = { _, e in NSLog("Avatar-Engine: \(e?.toString() ?? "?")") }
        // Konstante V der Engine: Stützpunkte je Rundkörper (144, schnell 72). Kopf- und Längenraster (25/73, 33/73) müssen bleiben,
        // sonst fehlen Teile der Umrisse bei Kegel und Würfel.
        let source = fine ? AvatarEngineSource.js
            : AvatarEngineSource.js.replacingOccurrences(of: "Se=25,Ce=73,V=144,we=33,Te=73", with: "Se=25,Ce=73,V=72,we=33,Te=73")
        c.evaluateScript(source)
        c.evaluateScript("""
        var __S = {};
        function __setup(id, surface, nodes) { __S[id] = { surface: surface, nodes: nodes }; }
        function __render(id, f, blink, ox, oy) {
          var e = { id: 'x', headX: f[0], headY: f[1], headZ: f[2], widthLeft: f[3], widthRight: f[4], heightLeft: f[5], heightRight: f[6], spacing: f[7],
            positionXLeft: f[8], positionXRight: f[9], positionYLeft: f[10], positionYRight: f[11], leftAngle: f[12], rightAngle: f[13],
            perspective: f[14], eyeMotion: 'none', bodyMotion: 'none' };
          var g = AvatarProceduralEngine.renderAvatar(AvatarProceduralEngine.poseFromExpression(e), __S[id].surface, blink,
            { includeWire: false, bodyNodes: __S[id].nodes, eyeOffset: { x: ox, y: oy } });
          return [g.backPaths, g.headPath, g.leftPath, g.rightPath, g.leftVisible, g.rightVisible, g.frontPaths];
        }
        """)
        contexts[fine] = c
        for (shape, d) in definitions { c.objectForKeyedSubscript("__setup").call(withArguments: [shape.rawValue, d.surface, d.bodyNodes]) }
        return c
    }

    func definition(_ shape: OrbiShape) -> AvatarDefinition {
        if let d = definitions[shape] { return d }
        let json = AvatarAnimData.avatars[shape.rawValue] ?? AvatarAnimData.avatars["strobi"]!
        let d = AvatarDefinition(json: json)!
        definitions[shape] = d
        for c in contexts.values { c.objectForKeyedSubscript("__setup").call(withArguments: [shape.rawValue, d.surface, d.bodyNodes]) }
        return d
    }

    func geometry(shape: OrbiShape, expression: AvatarExpression, blink: Double, eye: CGPoint = .zero, fine: Bool = false) -> AvatarGeometry {
        _ = definition(shape)
        let key = "\(fine)|\(shape.rawValue)|\(expression.cacheKey)|\(Int((blink * 20).rounded()))|\(Int((eye.x * 4).rounded())),\(Int((eye.y * 4).rounded()))"
        if let g = cache[key] { return g }
        guard let r = context(fine: fine).objectForKeyedSubscript("__render").call(withArguments: [shape.rawValue, expression.v, blink, eye.x, eye.y]),
              let parts = r.toArray(), parts.count == 7 else { return AvatarGeometry() }
        func paths(_ any: Any?) -> [CGPath] { (any as? [String] ?? []).map { SVGPath.parse($0) } }
        var g = AvatarGeometry()
        g.back = paths(parts[0])
        g.head = SVGPath.parse(parts[1] as? String ?? "")
        g.left = SVGPath.parse(parts[2] as? String ?? "")
        g.right = SVGPath.parse(parts[3] as? String ?? "")
        g.leftVisible = parts[4] as? Bool ?? true
        g.rightVisible = parts[5] as? Bool ?? true
        g.front = paths(parts[6])
        g.blink = blink
        if cache.count > 3000 { cache.removeAll(keepingCapacity: true) }
        cache[key] = g
        return g
    }
}
