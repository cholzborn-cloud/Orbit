import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-figuren <Ordner>`: prüft Katalog, Farbableitung, Doppelgänger-Regel, Zeigerfolgen, Blinzeln, Zustände und
// Ereignislogik, rendert alle 10 Figuren in allen Zuständen (Dunkel und Hell) per ImageRenderer in den Ordner und gibt JSON aus.
// Ohne Fenster und Dock-Symbol, Exit 0 oder 1. Die Zeit läuft simuliert (feste Zufallszahlen), der Zeiger ist ein Testwert.
@MainActor
enum SelfTestFigures {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    private final class TestTicker: Ticking {
        var tickInterval = 0.5
        var tickVisible = true
        var ticks = 0
        func tick(now: TimeInterval) { ticks += 1 }
    }

    // Ohne Fenster und ohne Dienst: Layerwechsel, reduzierte Bewegung und reiner Zeichenaufwand für fünf Figuren.
    static func animationDiagnostics() -> Int32 {
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String = "") { checks.append(Check(name: name, ok: ok, detail: detail)) }
        let look = OrbiLook(shape: .strobi)
        let view = FigureLayerView(frame: NSRect(x: 0, y: 0, width: 40, height: 40))
        view.layoutSubtreeIfNeeded()
        view.apply(look: look, state: .calm, reduceMotion: false, role: .sidebar)
        let before = (view.layer?.sublayers?.first?.contents).map { $0 as! CGImage }?.dataProvider?.data as Data?
        view.apply(look: look, state: .listening, reduceMotion: false, role: .sidebar)
        let previous = view.layer?.sublayers?.last
        let initial = previous?.opacity ?? 0
        let copied = (previous?.contents).map { $0 as! CGImage }?.dataProvider?.data as Data?
        check("Systemwechsel übernimmt das vorherige Bild", before != nil && before == copied && initial > 0.99)
        let start = Date.timeIntervalSinceReferenceDate
        var opacities = [Double]()
        for i in 0...36 {
            view.tick(now: start + Double(i) / 60)
            opacities.append(Double(previous?.opacity ?? -1))
        }
        check("Überblendung fällt ohne Deckkraftsprung", zip(opacities, opacities.dropFirst()).allSatisfy { $0.0 >= $0.1 && $0.0 - $0.1 < 0.06 } && (opacities.last ?? 1) == 0)
        view.apply(look: look, state: .waiting, reduceMotion: true, role: .sidebar)
        check("Bewegung reduzieren beendet Überblendung", previous?.opacity == 0 && previous?.contents == nil)
        let retry = FigureLayerView(frame: NSRect(x: 0, y: 0, width: 40, height: 40))
        retry.layoutSubtreeIfNeeded()
        func labPlayer(_ view: FigureLayerView) -> AvatarPlayer? {
            Mirror(reflecting: view).children.first { $0.label == "player" }?.value as? AvatarPlayer
        }
        retry.apply(look: look, state: .error, reduceMotion: false, role: .sidebar)
        let firstPlayer = labPlayer(retry)
        let labTime = Date.timeIntervalSinceReferenceDate
        firstPlayer?.setRunning(true, now: labTime)
        let initialError = firstPlayer?.frame(now: labTime, state: .error, chatOpen: false, reduceMotion: false).expression
        let lateError = firstPlayer?.frame(now: labTime + 20, state: .error, chatOpen: false, reduceMotion: false).expression
        retry.apply(look: look, state: .working, reduceMotion: false, role: .sidebar)
        retry.apply(look: look, state: .error, reduceMotion: false, role: .sidebar)
        let repeatedPlayer = labPlayer(retry)
        let repeatedError = repeatedPlayer?.frame(now: Date.timeIntervalSinceReferenceDate, state: .error, chatOpen: false, reduceMotion: false).expression
        check("Erneuter Fehler startet Lab-Animation neu", initialError != nil && initialError != lateError && firstPlayer !== repeatedPlayer && initialError == repeatedError,
              "vorhanden \(initialError != nil), Ablauf fortgeschritten \(initialError != lateError), neuer Player \(firstPlayer !== repeatedPlayer), Anfangspose \(initialError == repeatedError), Anfang \(initialError?.v ?? []), erneut \(repeatedError?.v ?? [])")
        for mood in [OrbiMood.idle, .selected, .head, .message, .working, .waiting, .done] {
            let pose = OrbiBehavior.still(mood)
            check("Statische Pose \(mood)", pose.x == 0 && pose.y == 0 && pose.flipX == 0 && pose.flipY == 0 && pose.sparks.isEmpty)
        }

        let ticker = FigureTicker(), sleeper = TestTicker()
        ticker.add(sleeper)
        sleeper.tickInterval = 1.0 / 60
        ticker.wake(sleeper)
        let otherTicker = FigureTicker(), otherSleeper = TestTicker(), newcomer = TestTicker()
        otherTicker.add(otherSleeper)
        newcomer.tickInterval = 1.0 / 60
        otherTicker.add(newcomer)
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.2))
        check("Zustandswechsel weckt den Takt zeitnah", sleeper.ticks > 0)
        check("Neue Figur weckt den Takt zeitnah", newcomer.ticks > 0)
        sleeper.tickVisible = false; otherSleeper.tickVisible = false; newcomer.tickVisible = false

        let frequentTicker = FigureTicker(), frequent = TestTicker()
        frequent.tickInterval = 1.0 / 60
        frequentTicker.add(frequent)
        let scheduled = frequentTicker.timer
        for _ in 0..<20 { frequentTicker.wake(frequent) }
        check("Häufiges Aufwecken erhält den früheren Termin", scheduled != nil && frequentTicker.timer === scheduled)
        for _ in 0..<20 {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.008))
            frequentTicker.wake(frequent)
        }
        check("Häufiges Aufwecken verschiebt den Takt nicht", frequent.ticks > 0)
        frequent.tickVisible = false

        let paused = OrbiBehavior(random: { a, _ in a }), reference = OrbiBehavior(random: { a, _ in a })
        paused.setMood(.waiting); reference.setMood(.waiting)
        paused.step(now: 100, run: true, mouse: nil); reference.step(now: 100, run: true, mouse: nil)
        paused.setRunning(false, now: 100.5)
        let resumed = paused.step(now: 200.5, run: true, mouse: nil)
        let expected = reference.step(now: 100.5, run: true, mouse: nil)
        check("Verdeckte Figur setzt Bewegung ohne Zeitsprung fort", abs(resumed.x - expected.x) < 0.0001 && abs(resumed.lx - expected.lx) < 0.0001 && abs(resumed.tilt - expected.tilt) < 0.0001)

        let spin = OrbiBehavior(random: { a, _ in a })
        spin.setMood(.working); spin.step(now: 100, run: true, mouse: nil)
        spin.forceSpin(turn: false, now: 100.1)
        let beforePause = spin.step(now: 100.3, run: true, mouse: nil)
        spin.step(now: 100.3, run: false, mouse: nil)
        let afterPause = spin.step(now: 200.3, run: true, mouse: nil)
        check("Verdeckter Sprung läuft nach Pause weiter", abs(beforePause.flipX - afterPause.flipX) < 0.0001 && abs(beforePause.y - afterPause.y) < 0.0001)

        let pausedLab = AvatarPlayer(shape: .strobi), referenceLab = AvatarPlayer(shape: .strobi)
        func lab(_ player: AvatarPlayer, _ now: Double) -> AvatarFrame { player.frame(now: now, state: .limit, chatOpen: false, reduceMotion: false) }
        _ = lab(pausedLab, 100); _ = lab(referenceLab, 100)
        let beforeLab = lab(pausedLab, 100.5)
        pausedLab.setRunning(false, now: 100.5)
        let frozenLab = lab(pausedLab, 150)
        pausedLab.setRunning(true, now: 200.5)
        let resumedLab = lab(pausedLab, 201)
        let expectedLab = lab(referenceLab, 101)
        check("Verdeckte Lab-Figur hält und setzt ihre Pose fort", beforeLab.expression == frozenLab.expression && resumedLab.expression == expectedLab.expression && frozenLab.blink == beforeLab.blink)

        let behaviors = (0..<5).map { _ in OrbiBehavior() }
        behaviors.forEach { $0.setMood(.working) }
        var durations: [Double] = []
        for frame in 0..<60 {
            let t0 = ContinuousClock.now
            for behavior in behaviors {
                let pose = behavior.step(now: Double(frame) / 60, run: true, mouse: nil)
                let geometry = FigureLayerView.geometry(look: look, pose: pose, fine: false)
                _ = FigureRenderer.image(size: CGSize(width: 64, height: 64), scale: 2) {
                    FigureRenderer.draw($0, size: CGSize(width: 64, height: 64), look: look, geometry: geometry, margin: FigureLayerView.margin, pose: pose)
                }
            }
            durations.append((ContinuousClock.now - t0).milliseconds)
        }
        let sorted = durations.sorted()
        let report: [String: Any] = [
            "ok": checks.allSatisfy(\.ok),
            "checks": checks.map { ["name": $0.name, "ok": $0.ok, "detail": $0.detail] as [String: Any] },
            "zeichnungszeit_fuenf_figuren_ms": ["median": sorted[sorted.count / 2], "p95": sorted[Int(Double(sorted.count - 1) * 0.95)], "maximum": sorted.last ?? 0],
            "hinweis": "Nur synchroner Zeichenaufwand, keine Messung sichtbarer Frames oder des gesamten Fensters."
        ]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { print(String(decoding: data, as: UTF8.self)) }
        return checks.allSatisfy(\.ok) ? 0 : 1
    }

    static func run(arguments: [String]) async -> Int32 {
        guard let index = arguments.firstIndex(of: "--selftest-figuren"), arguments.indices.contains(index + 1) else {
            FileHandle.standardError.write(Data("Aufruf: Orbit --selftest-figuren <Ordner>\n".utf8))
            return 1
        }
        let directory = URL(fileURLWithPath: arguments[index + 1])
        var checks: [Check] = []
        var measurements: [String: Any] = [:]
        func check(_ name: String, _ ok: Bool, _ detail: String) { checks.append(Check(name: name, ok: ok, detail: detail)) }
        func near(_ a: Double, _ b: Double, _ tolerance: Double) -> Bool { abs(a - b) <= tolerance }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            catalog(check)
            looks(check, &measurements)
            twins(check)
            animation(check, &measurements)
            board(check)
            layer(check, &measurements)
            await liveConnection(check)
            measurements["bilder"] = try await render(directory: directory, check)
        } catch {
            check("Ablauf", false, error.localizedDescription)
        }
        let ok = checks.allSatisfy(\.ok)
        let report: [String: Any] = [
            "ok": ok,
            "checks": checks.map { ["name": $0.name, "ok": $0.ok, "detail": $0.detail] as [String: Any] },
            "messwerte": measurements,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            print(String(decoding: data, as: UTF8.self))
        }
        return ok ? 0 : 1
    }

    // MARK: Katalog und Farben

    private static func catalog(_ check: (String, Bool, String) -> Void) {
        let names = OrbiShape.allCases.map(\.displayName)
        check("Katalog", names.count == 15, names.joined(separator: " "))
        // Engine: jede Form liefert Umriss und zwei Augen innerhalb des Rahmens.
        let engine = AvatarEngine.shared
        let ok = OrbiShape.allCases.allSatisfy { shape in
            let g = engine.geometry(shape: shape, expression: engine.definition(shape).neutral, blink: 1)
            let box = g.head.boundingBox
            return box.width > 80 && box.width < 400 && !g.left.boundingBox.isNull && !g.right.boundingBox.isNull && g.left.boundingBox.width > 2
        }
        check("Engine: Umriss und Augen je Form", ok, "15 Formen")
        let own = OrbiLook(avatar: "marsi", colorHex: "#E8590C")
        check("Gespeicherte Farbe wird unverändert gezeichnet", own.bodyHex == "#e8590c" && OrbiLook(avatar: "marsi", colorHex: nil).bodyHex == OrbiShape.cubee.baseHex, own.bodyHex)
    }

    private static func looks(_ check: (String, Bool, String) -> Void, _ m: inout [String: Any]) {
        let nepi = OrbiLook(avatar: "nepi", colorHex: "#ec4899")
        check("Look aus Bot-Daten (Nepi #ec4899)", nepi.shape == .trixi && near(nepi.hue, 330.3, 1) && near(nepi.saturation, 80.4, 1), "Farbton \(Int(nepi.hue)) Stärke \(Int(nepi.saturation)) %")
        let plain = OrbiLook(avatar: "universi", colorHex: nil)
        check("Look ohne Farbe: Grundfarbe, universi = Sunee", plain.shape == .sunee && plain.hue == OrbiShape.sunee.defaultHue, "Farbton \(Int(plain.hue))")
        check("Unbekannter Avatar wird stabil zugeordnet", OrbiShape(avatar: "xyz") == OrbiShape(avatar: "xyz"), OrbiShape(avatar: "xyz").rawValue)
        m["nepiLook"] = ["farbton": nepi.hue, "staerke": nepi.saturation]
    }

    private static func near(_ a: Double, _ b: Double, _ t: Double) -> Bool { abs(a - b) <= t }

    // MARK: Doppelgänger

    private static func twins(_ check: (String, Bool, String) -> Void) {
        let a = OrbiLook(shape: .strobi, hue: 212), close = OrbiLook(shape: .strobi, hue: 222), far = OrbiLook(shape: .strobi, hue: 330)
        check("Doppelgänger: nah gleicher Planet", Similarity.isTwin(a, close), "Abstand \(Int(Similarity.hueDistance(a.oklchHue, close.oklchHue)))°")
        check("Kein Doppelgänger: weit oder anderer Planet", !Similarity.isTwin(a, far) && !Similarity.isTwin(a, OrbiLook(shape: .kirby, hue: 212)), "")
        check("Farbkreis umläuft die Null", Similarity.hueDistance(350, 10) == 20, "")
        let others = [120.0, 240].map { OrbiLook(shape: .strobi, hue: $0) }
        let me = OrbiLook(shape: .strobi, hue: 0)
        let free = Similarity.nextFreeHue(for: me, among: others)
        let minDistance = others.map { Similarity.hueDistance(OrbiLook(shape: .strobi, hue: free).oklchHue, $0.oklchHue) }.min() ?? 0
        check("Nächste freie Farbe hält Abstand", minDistance >= Similarity.threshold, "Farbton \(Int(free)), Mindestabstand \(Int(minDistance))°")
    }

    // MARK: Animationen (simulierte Zeit)

    private static func animation(_ check: (String, Bool, String) -> Void, _ m: inout [String: Any]) {
        func frames(_ player: AvatarPlayer, _ state: OrbiState, open: Bool = false, from: Double, to: Double, fps: Double = 30, reduced: Bool = false) -> [AvatarFrame] {
            stride(from: from, through: to, by: 1 / fps).map { player.frame(now: $0, state: state, chatOpen: open, reduceMotion: reduced) }
        }
        let engine = AvatarEngine.shared
        let h = 0, z = 2, p = 14   // headX, headZ, perspective (Reihenfolge AvatarExpression.fields)

        // Ruhig: Chat zu = Ruhepose (Kopf rechts geneigt), Chat offen = Blick wandert (andere Folge)
        do {
            let closed = AvatarPlayer(shape: .strobi), open = AvatarPlayer(shape: .strobi)
            let a = frames(closed, .calm, from: 0, to: 12), b = frames(open, .calm, open: true, from: 0, to: 12)
            let tilt = a.map { $0.expression.v[z] }
            check("Ruhig, Chat zu: nach rechts geneigt, atmet", tilt.allSatisfy { $0 > 5 } && Set(a.map { Int($0.expression.v[p] * 100) }).count > 5, String(format: "Neigung %.1f…%.1f°", tilt.min() ?? 0, tilt.max() ?? 0))
            check("Ruhig, Chat offen: Blick wandert (andere Folge)", a.map(\.expression) != b.map(\.expression), "")
        }
        // Wartet: nach 30 s ungeduldiger (Hibbeln = große Kippbewegung)
        do {
            let pl = AvatarPlayer(shape: .strobi)
            let early = frames(pl, .waiting, from: 0, to: 26).map { abs($0.expression.v[z]) }.max() ?? 0
            let late = frames(pl, .waiting, from: 26, to: 70).map { abs($0.expression.v[z]) }.max() ?? 0
            check("Wartet: nach 30 s Hibbeln", early < 2 && late > 8, String(format: "Kippen früh %.1f°, spät %.1f°", early, late))
        }
        // Fertig: hüpft (Nähe > 1,1), danach Stolz (Kopf hoch) bis zum Ende
        do {
            let pl = AvatarPlayer(shape: .strobi)
            let first = frames(pl, .done, from: 0, to: 2.5).map { $0.expression.v[p] }.max() ?? 0
            let late = frames(pl, .done, from: 2.5, to: 120).map { $0.expression.v[h] }
            check("Fertig: hüpft, danach Stolz", first > 1.1 && (late.suffix(300).min() ?? 0) > 8, String(format: "Nähe %.2f, Kopf hoch ab 2,5 s: min %.1f°", first, late.suffix(300).min() ?? 0))
        }
        // Fehler: dreimal schütteln (Drehung links/rechts), danach traurig (Kopf hängt, kein Schütteln)
        do {
            let pl = AvatarPlayer(shape: .strobi)
            let shake = frames(pl, .error, from: 0, to: 6).map { abs($0.expression.v[1]) }.max() ?? 0
            let after = frames(pl, .error, from: 12, to: 40)
            check("Fehler: schüttelt, danach traurig stehen", shake > 15 && after.suffix(300).allSatisfy { abs($0.expression.v[1]) < 1 && $0.expression.v[h] < -8 },
                  String(format: "Schütteln %.1f°, danach Kopf %.1f°", shake, after.last?.expression.v[h] ?? 0))
        }
        // Übergänge weich: beim Zustandswechsel springt keine Zahl
        do {
            let pl = AvatarPlayer(shape: .strobi)
            _ = frames(pl, .working, from: 0, to: 3.2)
            let before = pl.frame(now: 3.2, state: .working, chatOpen: false, reduceMotion: false).expression
            let after = frames(pl, .error, from: 3.2 + 1 / 24, to: 3.45, fps: 24)   // innerhalb des Überblendens (0,28 s)
            var worst = 0.0, worstField = 0
            var last = before
            for f in after { for i in f.expression.v.indices where abs(f.expression.v[i] - last.v[i]) > worst { worst = abs(f.expression.v[i] - last.v[i]); worstField = i }; last = f.expression }
            check("Zustandswechsel blendet schnell und ohne Sprung über (24 Bilder/s)", worst < 14, String(format: "größter Schritt %.2f je Bild (Feld %d)", worst, worstField) + " " + after.map { String(format: "%.1f", $0.expression.v[1]) }.joined(separator: ","))
        }
        // Blinzeln kommt vor, bleibt in 0…1
        do {
            let pl = AvatarPlayer(shape: .strobi)
            let b = frames(pl, .working, from: 0, to: 40, fps: 60).map(\.blink)
            let c = frames(AvatarPlayer(shape: .strobi), .calm, from: 0, to: 40, fps: 60).map(\.blink)
            check("Blinzeln: kommt vor, bleibt in 0…1", (c.min() ?? 1) < 0.1 && (b + c).allSatisfy { $0 >= 0 && $0 <= 1 }, String(format: "tiefster Wert %.2f", c.min() ?? 1))
        }
        // Bewegung reduzieren: eine feste Pose
        do {
            let pl = AvatarPlayer(shape: .strobi)
            let f = frames(pl, .working, from: 0, to: 20, fps: 10, reduced: true)
            check("Bewegung reduzieren: feste Pose", Set(f.map { $0.expression.cacheKey }).count == 1 && f.allSatisfy { $0.blink == 1 }, "")
        }
        // Blick zur Maus verschiebt die Augen
        do {
            let e0 = engine.definition(.strobi).neutral
            let a = engine.geometry(shape: .strobi, expression: e0, blink: 1).left.boundingBox
            let b = engine.geometry(shape: .strobi, expression: e0, blink: 1, eye: CGPoint(x: 16, y: 0)).left.boundingBox
            let c = engine.geometry(shape: .strobi, expression: e0, blink: 1, eye: CGPoint(x: 0, y: -16)).left.boundingBox
            check("Blick zur Maus: Augen rechts und oben", b.midX - a.midX > 3 && a.midY - c.midY > 3, String(format: "rechts +%.1f, oben +%.1f", b.midX - a.midX, a.midY - c.midY))
        }
        // Maus: nur über der Figur, Richtung stimmt (y nach unten), außerhalb Mitte, Blickstärke wirkt
        do {
            let f = CGRect(x: 100, y: 100, width: 40, height: 40)
            let right = FigureLayerView.hoverTarget(pointer: CGPoint(x: 135, y: 120), frame: f, gaze: 1)
            let up = FigureLayerView.hoverTarget(pointer: CGPoint(x: 120, y: 138), frame: f, gaze: 1)
            let outside = FigureLayerView.hoverTarget(pointer: CGPoint(x: 300, y: 120), frame: f, gaze: 1)
            let weak = FigureLayerView.hoverTarget(pointer: CGPoint(x: 135, y: 120), frame: f, gaze: 0.5)
            check("Maus: nur über der Figur, Richtung stimmt", right.x > 8 && abs(right.y) < 1 && up.y < -8 && outside == .zero && abs(weak.x - right.x / 2) < 0.01,
                  String(format: "rechts (%.1f, %.1f), oben (%.1f, %.1f), außen (%.0f, %.0f)", right.x, right.y, up.x, up.y, outside.x, outside.y))
        }
        // Nur sichtbare Figuren, bei inaktiver App pausiert
        let view = FigureLayerView(frame: NSRect(x: 0, y: 0, width: 40, height: 40))
        check("Unsichtbare Figur (ohne Fenster) animiert nicht", !view.tickVisible, "tickVisible = \(view.tickVisible)")
        check("App inaktiv: Takt pausiert", !NSApp.isActive || !view.tickVisible, "NSApp.isActive = \(NSApp.isActive)")
    }

    // Der Live-Layer zeichnet ohne Fenster nur auf Zuruf (`tick`): Bild entsteht in Pixelgröße und ändert sich mit dem Zustand.
    private static func layer(_ check: (String, Bool, String) -> Void, _ m: inout [String: Any]) {
        let view = FigureLayerView(frame: NSRect(x: 0, y: 0, width: 52, height: 52))
        view.layoutSubtreeIfNeeded()
        view.apply(look: OrbiLook(shape: .trixi, hue: 330, saturation: 80), state: .calm, reduceMotion: true)
        func contents() -> CGImage? { (view.layer?.sublayers?.first?.contents).map { $0 as! CGImage } }
        func bytes(_ image: CGImage?) -> Data? { image?.dataProvider?.data as Data? }
        let calm = contents()
        view.apply(look: OrbiLook(shape: .trixi, hue: 330, saturation: 80), state: .error, reduceMotion: true)
        let waiting = contents()
        check("Live-Layer zeichnet und reagiert auf den Zustand", calm != nil && waiting != nil && calm?.width == Int((52 * (1 + 2 * FigureLayerView.margin / 80) * 2).rounded()) && bytes(calm) != bytes(waiting),
              "Bild \(calm?.width ?? 0)×\(calm?.height ?? 0) px, Zustandswechsel ändert das Bild; Bytes \(bytes(calm)?.count ?? -1) / \(bytes(waiting)?.count ?? -1), gleich: \(bytes(calm) == bytes(waiting))")
        // Rechenzeit je neuem Bild (JavaScript-Engine + Zeichnen): bestimmt die CPU bei laufender Animation
        let look = OrbiLook(shape: .sunee, hue: 45, saturation: 58)   // aufwendigste Form (8 Kugeln)
        let engine = AvatarEngine.shared
        var expression = engine.definition(.sunee).neutral
        let runs = 120
        var geometryMs = 0.0, drawMs = 0.0
        for i in 0..<runs {
            expression.v[2] = Double(i) * 0.1   // jedes Bild neu (kein Treffer im Zwischenspeicher)
            let t0 = ContinuousClock.now
            let g = engine.geometry(shape: .sunee, expression: expression, blink: 1)
            let t1 = ContinuousClock.now
            _ = FigureRenderer.image(size: CGSize(width: 52, height: 52), scale: 2) { FigureRenderer.draw($0, size: CGSize(width: 52, height: 52), look: look, geometry: g) }
            geometryMs += (t1 - t0).milliseconds; drawMs += (ContinuousClock.now - t1).milliseconds
        }
        var shapeMean = 0.0
        for shape in OrbiShape.allCases {
            var e = engine.definition(shape).neutral
            let t0 = ContinuousClock.now
            for i in 0..<20 { e.v[2] = 80 + Double(i) * 0.2; _ = engine.geometry(shape: shape, expression: e, blink: 1) }
            shapeMean += (ContinuousClock.now - t0).milliseconds / 20 / Double(OrbiShape.allCases.count)
        }
        check("Engine im Mittel unter 10 ms (Sunee unter 20; Messung schwankt mit der Last), Zeichnen unter 2 ms je Bild", shapeMean < 10 && geometryMs / Double(runs) < 20 && drawMs / Double(runs) < 2,
              String(format: "Engine im Mittel %.2f ms, Sunee %.2f ms, Zeichnen %.2f ms (52 pt, 2x)", shapeMean, geometryMs / Double(runs), drawMs / Double(runs)))
        var perShape: [String: Double] = [:]
        for shape in OrbiShape.allCases {
            var e = engine.definition(shape).neutral
            let t0 = ContinuousClock.now
            for i in 0..<30 { e.v[2] = 50 + Double(i) * 0.1; _ = engine.geometry(shape: shape, expression: e, blink: 1) }
            perShape[shape.rawValue] = (ContinuousClock.now - t0).milliseconds / 30
        }
        m["engine_je_form_ms"] = perShape
        // CPU je Sekunde Animation: erster Durchlauf (leerer Zwischenspeicher) und Wiederholung (Treffer)
        var cost: [String: Any] = [:]
        for (name, shape, state) in [("Strobi ruhig", OrbiShape.strobi, OrbiState.calm), ("Cubee arbeitet", .cubee, .working), ("Sunee arbeitet", .sunee, .working)] {
            func pass() -> Double {
                let player = AvatarPlayer(shape: shape)
                let t0 = ContinuousClock.now
                for i in 0..<(12 * 24) {
                    let f = player.frame(now: 100 + Double(i) / 24, state: state, chatOpen: false, reduceMotion: false)
                    let g = engine.geometry(shape: shape, expression: f.expression, blink: f.blink)
                    _ = FigureRenderer.image(size: CGSize(width: 52, height: 52), scale: 2) { FigureRenderer.draw($0, size: CGSize(width: 52, height: 52), look: OrbiLook(shape: shape), geometry: g) }
                }
                return (ContinuousClock.now - t0).milliseconds / 12   // ms je Sekunde Animation
            }
            cost[name] = ["erster_durchlauf_ms_je_s": pass(), "wiederholung_ms_je_s": pass()]
        }
        m["cpu_je_animationssekunde"] = cost
        m["engine_ms"] = geometryMs / Double(runs)
        m["zeichenzeit_ms"] = drawMs / Double(runs)
    }

    // MARK: Ereignislogik

    private static func board(_ check: (String, Bool, String) -> Void) {
        func json(_ object: [String: Any]) -> Data { (try? JSONSerialization.data(withJSONObject: object)) ?? Data() }
        func status(_ chat: String, _ bot: String, _ status: String) -> Data { json(["type": "status", "chatId": chat, "botId": bot, "status": status]) }
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        var board = OrbiStatusBoard()
        board.apply(line: json(["type": "snapshot", "approvals": [], "automations": [],
                                "working": [["type": "status", "chatId": "c1", "botId": "b1", "status": "arbeitet"]]]), now: t0)
        check("Snapshot setzt „arbeitet“", board.state(forBot: "b1") == .working && board.state(forChat: "c1") == .working, "")
        board.apply(line: status("c1", "b1", "wartet"), now: t0)
        check("Live: wartet", board.state(forBot: "b1") == .waiting, "")
        board.apply(line: status("c2", "b1", "arbeitet"), now: t0)
        check("Mehrere Chats: Rückfrage hat Vorrang", board.state(forBot: "b1") == .waiting && board.state(forChat: "c2") == .working, "")
        board.apply(line: status("c1", "b1", "fertig"), now: t0)
        check("Live: fertig", board.state(forChat: "c1") == .done && board.state(forBot: "b1") == .working, "")
        var late = board; late.prune(now: t0.addingTimeInterval(3600))
        var seen = board; seen.acknowledge(chatId: "c1")
        check("„Fertig“ bleibt, bis der Chat geöffnet wird", late.state(forChat: "c1") == .done && seen.state(forChat: "c1") == .calm, "")
        board.apply(line: status("c2", "b1", "fehler"), now: t0)
        var e1 = board; e1.prune(now: t0.addingTimeInterval(59))
        var e2 = board; e2.prune(now: t0.addingTimeInterval(61))
        check("Fehler bleibt 60 s", e1.state(forChat: "c2") == .error && e2.state(forChat: "c2") == .calm, "")
        board.apply(line: status("c2", "b1", "ruhig"), now: t0)
        check("ruhig entfernt den Eintrag", board.state(forChat: "c2") == .calm, "")
        board.apply(line: json(["type": "snapshot", "approvals": [], "automations": [], "working": []]), now: t0)
        check("Neuer Snapshot beim Wiederverbinden ersetzt alles", board.chats.isEmpty, "")
        board.apply(line: Data("kein json".utf8), now: t0)
        board.apply(line: json(["type": "approval", "id": "x"]), now: t0)
        check("Unbekanntes und kaputtes wird ignoriert", board.chats.isEmpty, "")
    }

    // Echte Verbindung zum laufenden Dienst: Snapshot kommt an.
    private static func liveConnection(_ check: (String, Bool, String) -> Void) async {
        let model = AppModel()
        defer { model.shutdown() }
        do {
            try await model.service.ensureRunning()
            model.events.start()
            let deadline = Date().addingTimeInterval(8)
            while !model.events.connected, Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
            check("GET /v1/events: Snapshot vom Dienst", model.events.connected, "verbunden = \(model.events.connected)")
        } catch {
            check("GET /v1/events: Snapshot vom Dienst", false, error.localizedDescription)
        }
    }

    // MARK: Bilder

    private static func render(directory: URL, _ check: (String, Bool, String) -> Void) async throws -> [String] {
        var written: [String] = []
        for dark in [true, false] {
            let name = dark ? "dunkel" : "hell"
            let overview = FigureOverview().environment(\.colorScheme, dark ? .dark : .light).environment(\.figuresStatic, true)
            written.append(try write(overview, to: directory, name: "mac4a1-figuren-\(name).png"))
            written.append(try write(GazeStrip(dark: dark).environment(\.colorScheme, dark ? .dark : .light).environment(\.figuresStatic, true),
                                     to: directory, name: "mac4a1-augen-folgen-\(name).png"))
        }
        // App-Symbol: alle fertigen Entwürfe in einem Bild, dazu eine Abwandlung mit eigenen Farben und die Einstellungen (kein Schreiben in die Einstellungen)
        var cells: [CGImage] = []
        for d in AppIconDesign.all { if let image = AppIconRenderer.image(AppIconConfig(design: d.id), side: 256) { cells.append(image) } }
        if let custom = AppIconRenderer.image(AppIconConfig(design: "sonne", colorHex: "#22c55e", backgroundHex: "#fde047"), side: 256) { cells.append(custom) }
        let sheet = CGContext(data: nil, width: 256 * 7, height: 256 * 2, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        for (i, image) in cells.enumerated() { sheet.draw(image, in: CGRect(x: (i % 7) * 256, y: (1 - i / 7) * 256, width: 256, height: 256)) }
        if let image = sheet.makeImage(), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
            try png.write(to: directory.appending(path: "app-symbol-entwuerfe.png")); written.append("app-symbol-entwuerfe.png")
        }
        written.append(try write(SettingsAppIconView().padding(Theme.Metrics.pt24).frame(width: 660).background(Theme.Palette.popover).environment(\.figuresStatic, true), to: directory, name: "app-symbol-einstellungen.png"))
        written.append(try write(MoodSheet().environment(\.figuresStatic, true), to: directory, name: "orbis-zustaende.png"))
        check("Übersichtsbilder", written.count == 7, written.joined(separator: ", "))
        return written
    }

    private static func write(_ view: some View, to directory: URL, name: String) throws -> String {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.cgImage else { throw SpikeError("Rendern fehlgeschlagen: \(name)") }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]) else { throw SpikeError("PNG fehlgeschlagen: \(name)") }
        try png.write(to: directory.appending(path: name))
        return name
    }
}

// Alle 10 Figuren (Zeilen) in allen 7 Zuständen (Spalten) mit Status-Ring und Beschriftung.
private struct FigureOverview: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Color.clear.frame(width: 70, height: 1)
                ForEach(OrbiState.allCases, id: \.self) { state in
                    Text(state.caption).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).frame(width: 110)
                }
            }
            ForEach(OrbiShape.allCases, id: \.self) { shape in
                HStack(spacing: 14) {
                    Text(shape.displayName).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.foreground).frame(width: 70, alignment: .leading)
                    ForEach(OrbiState.allCases, id: \.self) { state in
                        StateCell(shape: shape, state: state)
                    }
                }
            }
            // Gelöschter Orbi, Gruppe ohne Orbis, Gruppe mit drei Orbis
            HStack(spacing: 14) {
                Text("Sonst").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.foreground).frame(width: 70, alignment: .leading)
                OrbiAvatar(name: "Gelöschter Orbi", avatar: nil, colorHex: nil, size: 110, live: false)
                AvatarStack(members: [], size: 110)
                AvatarStack(members: [GroupMember(id: "1", name: "Erdi", avatar: "erdi", color: nil, look: nil), GroupMember(id: "2", name: "Marsi", avatar: "marsi", color: "#22c55e", look: BotLook(accessory: "cap", cheeks: true)),
                                      GroupMember(id: "3", name: "Sati", avatar: "sati", color: nil, look: BotLook(accessory: "sunglasses"))], size: 110)
                Text("gelöschter Orbi · Gruppe ohne Orbis · Gruppe mit drei Orbis").font(Theme.Fonts.small)
                    .foregroundStyle(Theme.Palette.mutedForeground).frame(width: 260, alignment: .leading)
            }
        }
        .padding(Theme.Metrics.pt24)
        .background(Theme.Palette.background)
    }
}

// Zustände des Designs Orbis als Bildfolge (simulierte Zeit, 30 Bilder je Sekunde): jede Zeile ein Zustand, jede Spalte ein Zeitpunkt.
private struct MoodSheet: View {
    private static let rows: [(String, OrbiMood, [Double])] = [
        ("nicht ausgewählt", .idle, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]),
        ("ausgewählt", .selected, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]),
        ("arbeitet", .working, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]),
        ("wartet", .waiting, [0.4, 0.8, 1.2, 1.6, 2, 5.5, 6.5, 7.5]),
        ("fertig", .done, [0.1, 0.45, 0.65, 0.85, 1.2, 1.5, 1.8, 2.0, 2.4, 3.2]),
        ("neben Nachrichten", .message, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]),
    ]
    private static func cells(_ mood: OrbiMood, at times: [Double], shape: OrbiShape) -> [(AvatarGeometry, OrbiPose)] {
        let behavior = OrbiBehavior()
        behavior.setMood(mood)
        var now = 1000.0
        var out: [(AvatarGeometry, OrbiPose)] = []
        let look = OrbiLook(shape: shape)
        var t = 0.0
        for target in times {
            while t < target { now += 1.0 / 30; t += 1.0 / 30; behavior.step(now: now, run: true, mouse: nil) }
            let pose = behavior.pose
            out.append((FigureLayerView.geometry(look: look, pose: pose, fine: true), pose))
        }
        return out
    }
    private static func spinCells(turn: Bool, shape: OrbiShape) -> [(AvatarGeometry, OrbiPose)] {
        let behavior = OrbiBehavior()
        behavior.setMood(.working)
        var now = 1000.0
        behavior.step(now: now, run: true, mouse: nil)
        behavior.forceSpin(turn: turn, now: now)
        var out: [(AvatarGeometry, OrbiPose)] = []
        let look = OrbiLook(shape: shape)
        for i in 1...10 {
            for _ in 0..<3 { now += 1.0 / 30; behavior.step(now: now, run: true, mouse: nil) }
            _ = i
            out.append((FigureLayerView.geometry(look: look, pose: behavior.pose, fine: true), behavior.pose))
        }
        return out
    }
    var body: some View {
        let shape = OrbiShape.rauti
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(Self.rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 0) {
                    Text(row.0).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).frame(width: 110, alignment: .leading)
                    ForEach(Array(Self.cells(row.1, at: row.2, shape: shape).enumerated()), id: \.offset) { _, cell in cellView(cell, shape: shape) }
                }
            }
            ForEach([("Drehung (Überschlag)", false), ("Drehung (seitlich)", true)], id: \.0) { title, turn in
                HStack(spacing: 0) {
                    Text(title).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).frame(width: 110, alignment: .leading)
                    ForEach(Array(Self.spinCells(turn: turn, shape: shape).enumerated()), id: \.offset) { _, cell in cellView(cell, shape: shape) }
                }
            }
        }
        .padding(Theme.Metrics.pt16)
        .background(Theme.Palette.background)
    }
    private func cellView(_ cell: (AvatarGeometry, OrbiPose), shape: OrbiShape) -> some View {
        Canvas { ctx, size in
            ctx.withCGContext { FigureRenderer.draw($0, size: size, look: OrbiLook(shape: shape), geometry: cell.0, margin: FigureLayerView.margin, pose: cell.1) }
        }
        .frame(width: 96, height: 96)
    }
}

// Eine Figur im Zustand, gezeichnet nach 2,7 s simulierter Zeit (mitten in der Animation).
private struct StateCell: View {
    let shape: OrbiShape
    let state: OrbiState
    var body: some View {
        let player = AvatarPlayer(shape: shape)
        let frame = (0...81).map { player.frame(now: Double($0) / 30, state: state, chatOpen: false, reduceMotion: false) }.last!
        let geometry = AvatarEngine.shared.geometry(shape: shape, expression: frame.expression, blink: frame.blink)
        Canvas { ctx, size in
            ctx.withCGContext { FigureRenderer.draw($0, size: size, look: OrbiLook(shape: shape), geometry: geometry, margin: FigureLayerView.margin) }
        }
        .frame(width: 110, height: 110)
    }
}

// Blick zur Maus als Bildfolge: Strobi mit Augenversatz nach links, rechts, oben, unten.
private struct GazeStrip: View {
    let dark: Bool
    var body: some View {
        HStack(spacing: 18) {
            ForEach([("links", CGPoint(x: -16, y: 0)), ("rechts", CGPoint(x: 16, y: 0)), ("oben", CGPoint(x: 0, y: -16)), ("unten", CGPoint(x: 0, y: 16)), ("Mitte", .zero)], id: \.0) { title, eye in
                VStack(spacing: 6) {
                    let g = AvatarEngine.shared.geometry(shape: .strobi, expression: AvatarEngine.shared.definition(.strobi).neutral, blink: 1, eye: eye)
                    Canvas { ctx, size in ctx.withCGContext { FigureRenderer.draw($0, size: size, look: OrbiLook(shape: .strobi), geometry: g) } }
                        .frame(width: 140, height: 140)
                    Text(title).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                }
            }
        }
        .padding(Theme.Metrics.pt24)
        .background(Theme.Palette.background)
    }
}

final class SelfTestFiguresDelegate: NSObject, NSApplicationDelegate {
    private let arguments: [String]
    init(arguments: [String]) { self.arguments = arguments }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = arguments
        Task { @MainActor in exit(await SelfTestFigures.run(arguments: arguments)) }
    }
}
