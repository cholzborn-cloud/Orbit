import AppKit
import SwiftUI
import XCTest

@MainActor
final class ThemeFigmaTests: XCTestCase {
    private var repository: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }

    func testAllColorAssetsMatchFigmaInBothAppearances() throws {
        let source = try Data(contentsOf: repository.appendingPathComponent("plan/design/variablen-vollstaendig.json"))
        let collections = try XCTUnwrap(JSONSerialization.jsonObject(with: source) as? [[String: Any]])
        func rows(_ name: String) throws -> [String: String] {
            let collection = try XCTUnwrap(collections.first { $0["name"] as? String == name })
            let entries = try XCTUnwrap(collection["rows"] as? [[String]])
            return Dictionary(uniqueKeysWithValues: entries.map { ($0[0], $0[2]) })
        }
        let primitives = try rows("Primitives")
        let appearances = try [rows("Color Light"), rows("Color Dark")]
        func resolved(_ value: String, colors: [String: String]) throws -> String {
            guard value.hasPrefix("→ ") else { return value }
            let key = String(value.dropFirst(2))
            return try resolved(XCTUnwrap(colors[key] ?? primitives[key]), colors: colors)
        }
        for name in appearances[0].keys {
            let path = "mac/Orbit/Assets.xcassets/Colors/" + name.replacingOccurrences(of: "/", with: "-") + ".colorset/Contents.json"
            let json = try JSONSerialization.jsonObject(with: Data(contentsOf: repository.appendingPathComponent(path)))
            let assets = try XCTUnwrap((json as? [String: Any])?["colors"] as? [[String: Any]])
            XCTAssertEqual(assets.count, 2, name)
            for (index, colors) in appearances.enumerated() {
                let expected = try resolved(XCTUnwrap(colors[name]), colors: colors)
                let hex = String(expected.prefix(7))
                let rgb = try XCTUnwrap(FigurePalette.rgb(hex: hex))
                let components = try XCTUnwrap((assets[index]["color"] as? [String: Any])?["components"] as? [String: String])
                for (key, value) in [("red", rgb.r), ("green", rgb.g), ("blue", rgb.b)] {
                    XCTAssertEqual(try XCTUnwrap(components[key].flatMap(Double.init)), value, accuracy: 0.000001, name)
                }
                let alpha = expected.components(separatedBy: " a").dropFirst().first.flatMap { Double($0.dropLast()) }.map { $0 / 100 } ?? 1
                XCTAssertEqual(try XCTUnwrap(components["alpha"].flatMap(Double.init)), alpha, accuracy: 0.000001, name)
            }
        }
    }

    func testCompiledColorsKeepTheirOpacity() throws {
        let product = Bundle(for: Self.self).bundleURL.deletingLastPathComponent().appendingPathComponent("Orbit.app")
        let bundle = try XCTUnwrap(Bundle(url: product))
        for name in ["background", "foreground", "orbi-auge", "orbi-blau", "bubble-reply"] {
            let color = try XCTUnwrap(NSColor(named: NSColor.Name(name), bundle: bundle)?.usingColorSpace(.sRGB), name)
            XCTAssertEqual(color.alphaComponent, 1, accuracy: 0.000001, name)
        }
    }

    func testFifteenPresetsKeepTheirExactServiceAndPreviewColor() {
        XCTAssertEqual(Theme.OrbiColor.all.count, 15)
        XCTAssertEqual(Set(BotEditorModel.colorPresets).count, 15)
        let editor = BotEditorModel(editing: nil, others: [])
        for color in Theme.OrbiColor.all {
            editor.useColor(hex: color.lightHex)
            XCTAssertEqual(editor.form.color, color.lightHex)
            XCTAssertEqual(editor.look.bodyHex, color.lightHex)
            XCTAssertEqual(Theme.OrbiColor.lookup(hex: color.darkHex)?.name, color.name)
        }
    }

    func testPaletteV3UsesTheApprovedExampleColors() {
        XCTAssertEqual(OrbiShape.trixi.paletteColor.name, "violett")
        XCTAssertEqual(OrbiShape.strobi.paletteColor.name, "blau")
        XCTAssertEqual(OrbiShape.citrus.paletteColor.name, "gelborange")
        XCTAssertEqual(OrbiShape.nova.paletteColor.name, "tuerkis")
    }

    func testFigmaLayoutAndReferenceTypography() {
        XCTAssertEqual(Theme.Layout.topBar, 52)
        XCTAssertEqual(Theme.Layout.rail, 88)   // Consti 05.11.: Schiene so breit, dass die Ampeln mittig sitzen
        XCTAssertEqual(Theme.Layout.sidebar, 240)
        XCTAssertEqual(Theme.Layout.column, 1040)
        XCTAssertEqual(Theme.Layout.columnGutter, 16)   // Grok-Bot-Abgleich 06.11.2026
        XCTAssertEqual(Theme.Radius.bubble, 18)
        XCTAssertEqual(Theme.Spacing.xxl, 32)
        XCTAssertEqual(Theme.Fonts.Reference.body, 17)
        XCTAssertEqual(Theme.Fonts.Reference.bodyLine, 22)
        XCTAssertEqual(Theme.Fonts.Reference.largeTitle, 24)
        XCTAssertEqual(Theme.Motion.hover.value(at: Theme.Motion.hover.duration / 2), 0.5, accuracy: 0.001)
    }

    // Figma „Einzel-/Gruppenchat Dunkel“ 151:93975, gemessen 04.11.2026 (plan/STATUS.md).
    func testChatLayoutMatchesFigma() {
        XCTAssertEqual(Theme.Layout.column * Theme.Layout.messageShare, 702)   // Grok-Bot-Abgleich 06.11.2026: Blasen bis gut zwei Drittel, dürfen über die Mitte
        XCTAssertEqual(Theme.Layout.rowGap, 4)
        XCTAssertEqual(Theme.Layout.senderGap, 12)
        XCTAssertEqual(Theme.Layout.chatTop, 16)
        XCTAssertEqual(Theme.Layout.header, 47)
        XCTAssertEqual(Theme.Layout.pill, 41)
        XCTAssertEqual(Theme.Layout.headerGap, 12)
        XCTAssertEqual(Theme.Layout.liveRow, 20)
        XCTAssertEqual(Theme.Layout.sidebarControls, 32)
        XCTAssertEqual(Theme.Layout.sidebar - 2 * Theme.Metrics.pt10, 220)   // Knopfzeile 220 × 32 im Seitenleisten-Kopf
        XCTAssertEqual(Theme.Radius.pill, 24)                                // Eingabefeld r24
    }

    func testEditorLabelsAndStaticGazeMatchFigma() {
        XCTAssertEqual(BotEditorModel.Tab.allCases.map(\.rawValue), ["Form", "Personalisieren"])
        let pose = OrbiBehavior.still(.idle)
        XCTAssertEqual(pose.lx, -0.8)
        XCTAssertEqual(pose.ly, -0.85)
        XCTAssertEqual(pose.blink, 0)
    }
    func testIdleRemainsStillAndWaitingNeverPacesOrHops() {
        let idle = OrbiBehavior()
        for time in stride(from: 0.0, through: 8, by: 0.05) {
            let pose = idle.step(now: time, run: true, mouse: nil)
            XCTAssertEqual(pose.lx, -0.8)
            XCTAssertEqual(pose.ly, -0.85)
            XCTAssertEqual(pose.blink, 0)
        }
        let waiting = OrbiBehavior()
        waiting.setMood(.waiting)
        for time in stride(from: 0.0, through: 8, by: 0.05) {
            let pose = waiting.step(now: time, run: true, mouse: nil)
            XCTAssertLessThanOrEqual(abs(pose.x), 5)
            // Der Übergang aus der geneigten Ruhepose darf zunächst weich ausklingen.
            if time >= Theme.Motion.figureTransition { XCTAssertLessThanOrEqual(abs(pose.tilt), 2.5) }
            XCTAssertEqual(pose.y, 0)
            XCTAssertEqual(pose.blink, 0)
        }
    }

    func testFigureModesAndReducedMotionPoses() {
        XCTAssertEqual(FigureMode.mood(role: .sidebar, state: .working, chatOpen: false), .working)
        XCTAssertEqual(FigureMode.mood(role: .sidebar, state: .waiting, chatOpen: false), .waiting)
        XCTAssertEqual(FigureMode.mood(role: .sidebar, state: .done, chatOpen: false), .done)
        XCTAssertEqual(FigureMode.mood(role: .empty, state: .calm, chatOpen: false), .empty)
        XCTAssertTrue(FigureMode.tracksPointer(role: .empty, hoverArea: true))
        XCTAssertFalse(FigureMode.tracksPointer(role: .empty, hoverArea: false))
        XCTAssertFalse(FigureMode.tracksPointer(role: .message, hoverArea: true))
        XCTAssertNil(FigureMode.mood(role: .sidebar, state: .listening, chatOpen: false))
        XCTAssertNil(FigureMode.mood(role: .sidebar, state: .error, chatOpen: false))
        XCTAssertNil(FigureMode.mood(role: .sidebar, state: .limit, chatOpen: false))
        for mood in [OrbiMood.idle, .selected, .head, .message, .working, .waiting, .done] {
            let pose = OrbiBehavior.still(mood)
            XCTAssertEqual(pose.x, 0); XCTAssertEqual(pose.y, 0)
            XCTAssertEqual(pose.flipX, 0); XCTAssertEqual(pose.flipY, 0)
            XCTAssertTrue(pose.sparks.isEmpty)
        }
        XCTAssertTrue(OrbiBehavior.still(.waiting).badge)
        XCTAssertEqual(OrbiBehavior.still(.done).dot, 1)
        XCTAssertEqual(FigureMode.transitionOpacity(elapsed: 0, reduceMotion: false), 1)
        XCTAssertEqual(FigureMode.transitionOpacity(elapsed: Theme.Motion.figureTransition / 2, reduceMotion: false), 0.5, accuracy: 0.001)
        XCTAssertEqual(FigureMode.transitionOpacity(elapsed: Theme.Motion.figureTransition, reduceMotion: false), 0)
        XCTAssertEqual(FigureMode.transitionOpacity(elapsed: 0, reduceMotion: true), 0)
    }

    func testEveryNumericFigmaTokenIsImplemented() throws {
        let source = try Data(contentsOf: repository.appendingPathComponent("plan/design/variablen-vollstaendig.json"))
        let collections = try XCTUnwrap(JSONSerialization.jsonObject(with: source) as? [[String: Any]])
        let collection = try XCTUnwrap(collections.first { $0["name"] as? String == "Tokens" })
        let rows = try XCTUnwrap(collection["rows"] as? [[String]])
        let implemented: [String: Double] = [
            "radius/sm": Double(Theme.Radius.sm),
            "radius/md": Double(Theme.Radius.md),
            "radius/lg": Double(Theme.Radius.lg),
            "radius/xl": Double(Theme.Radius.xl),
            "radius/xl2": Double(Theme.Radius.xl2),
            "radius/xl3": Double(Theme.Radius.xl3),
            "radius/bubble": Double(Theme.Radius.bubble),
            "radius/full": Double(Theme.Radius.full),
            "space/xs": Double(Theme.Spacing.xs),
            "space/sm": Double(Theme.Spacing.sm),
            "space/md": Double(Theme.Spacing.md),
            "space/lg": Double(Theme.Spacing.lg),
            "space/xl": Double(Theme.Spacing.xl),
            "space/xxl": Double(Theme.Spacing.xxl),
            "layout/top-bar": Double(Theme.Layout.topBar),
            "layout/rail": Double(Theme.Layout.rail),
            "layout/sidebar-min": Double(Theme.Layout.sidebarMin),
            "layout/sidebar": Double(Theme.Layout.sidebar),
            "layout/sidebar-max": Double(Theme.Layout.sidebarMax),
            "layout/panel-max": Double(Theme.Layout.panelMax),
            "layout/window-min-w": Double(Theme.Layout.windowMinWidth),
            "layout/window-min-h": Double(Theme.Layout.windowMinHeight),
            "layout/image-max": Double(Theme.Layout.imageMax),
            "layout/bubble-max": Double(Theme.Layout.column * Theme.Layout.messageShare),
            "motion/hover": Theme.Motion.hover.duration * 1000,
            "motion/pop": Theme.Motion.pop.duration * 1000,
            "motion/fade-in": Theme.Motion.fadeIn.duration * 1000,
            "motion/tooltip": Theme.Motion.tooltip.duration * 1000,
            "motion/panel": Theme.Motion.panel.duration * 1000,
            "motion/sidebar": Theme.Motion.sidebar.duration * 1000,
            "motion/tab": Theme.Motion.tab.duration * 1000,
            "motion/enter": Theme.Motion.enter.duration * 1000,
            "motion/header-snap": Theme.Motion.headerSnap.duration * 1000,
            "motion/typing-dot": Theme.Motion.typingDotDuration * 1000,
            "font/body": Double(Theme.Fonts.Reference.body),
            "font/body-line": Double(Theme.Fonts.Reference.bodyLine),
            "font/callout": Double(Theme.Fonts.Reference.callout),
            "font/subhead": Double(Theme.Fonts.Reference.subhead),
            "font/caption": Double(Theme.Fonts.Reference.caption),
            "font/title": Double(Theme.Fonts.Reference.title),
            "font/large-title": Double(Theme.Fonts.Reference.largeTitle),
        ]
        XCTAssertEqual(Set(implemented.keys), Set(rows.map { $0[0] }))
        for row in rows {
            // Chat-Layout Figma 151:93975 und Consti 04.11.2026 ersetzen den älteren Export: Grok-Bot-Abgleich 06.11.2026: beide Blasen = 67,5 % der Spalte (1040 → 702), Seitenleiste 240.
            let overrides: [String: Double] = ["layout/bubble-max": 702, "layout/sidebar": 240, "layout/sidebar-min": 240]
            let expected = try overrides[row[0]] ?? XCTUnwrap(Double(row[2]))
            XCTAssertEqual(try XCTUnwrap(implemented[row[0]]), expected, accuracy: 0.000001, row[0])
        }
    }

    func testHeadReturnsToRestOverFigmaDurationAndBlinks() {
        let behavior = OrbiBehavior(random: { lower, _ in lower })
        behavior.setMood(.head)
        _ = behavior.step(now: 0, run: true, mouse: nil)
        for index in 1...20 {
            _ = behavior.step(now: Double(index) * 0.05, run: true, mouse: CGPoint(x: 1, y: 0))
        }
        let start = behavior.step(now: 1.05, run: true, mouse: nil)
        let middle = behavior.step(now: 1.85, run: true, mouse: nil)
        XCTAssertEqual(middle.lx, (start.lx - 0.8) / 2, accuracy: 0.0001)
        let end = behavior.step(now: 2.65, run: true, mouse: nil)
        XCTAssertEqual(end.lx, -0.8, accuracy: 0.0001)
        XCTAssertEqual(end.ly, -0.85, accuracy: 0.0001)
        XCTAssertEqual(end.tilt, 9, accuracy: 0.0001)
        // Figma 148:84618/148:88246: Kopf und Panel blinzeln nicht; der Leerzustand blinzelt nach 2,5 s.
        let still = OrbiBehavior(random: { lower, _ in lower })
        still.setMood(.head)
        _ = still.step(now: 0, run: true, mouse: nil)
        XCTAssertEqual(still.step(now: 2.585, run: true, mouse: nil).blink, 0)
        let blink = OrbiBehavior(random: { lower, _ in lower })
        blink.setMood(.empty)
        _ = blink.step(now: 0, run: true, mouse: nil)
        XCTAssertEqual(blink.step(now: 2.49, run: true, mouse: nil).blink, 0)
        _ = blink.step(now: 2.5, run: true, mouse: nil)
        XCTAssertFalse(blink.settled)
        XCTAssertGreaterThan(blink.step(now: 2.585, run: true, mouse: nil).blink, 0.9)
        XCTAssertEqual(blink.step(now: 2.7, run: true, mouse: nil).blink, 0)
    }

    func testFigureMouseStrengthAndStillMessage() {
        let target = FigureMode.mouseLook(delta: CGPoint(x: 140, y: 0), width: 100, enhanced: true)
        XCTAssertEqual(target.x, tanh(1) * 1.5, accuracy: 0.0001)
        XCTAssertEqual(target.y, 0)
        XCTAssertEqual(FigureMode.mouseLook(delta: .zero, width: 100, enhanced: true), .zero)
        let message = OrbiBehavior(random: { lower, _ in lower })
        message.setMood(.message)
        for time in stride(from: 0.0, through: 8, by: 0.05) {
            XCTAssertEqual(message.step(now: time, run: true, mouse: nil), OrbiBehavior.still(.message))
        }
    }


    func testSelectedGazeUsesFigmaEaseAndDuration() {
        let behavior = OrbiBehavior(random: { lower, _ in lower })
        behavior.setMood(.selected)
        let start = behavior.step(now: 0, run: true, mouse: nil)
        XCTAssertEqual(start.lx, -0.8, accuracy: 0.0001)
        XCTAssertFalse(behavior.settled)
        let quarter = behavior.step(now: 0.175, run: true, mouse: nil)
        XCTAssertEqual(quarter.lx, -0.8 + 0.15625, accuracy: 0.0001)
        XCTAssertEqual(quarter.tilt, 9 + (0.6 - 9) * 0.15625, accuracy: 0.0001)
        let end = behavior.step(now: 0.7, run: true, mouse: nil)
        XCTAssertEqual(end.lx, 0.2, accuracy: 0.0001)
        XCTAssertEqual(end.ly, 0, accuracy: 0.0001)
        XCTAssertEqual(end.tilt, 0.6, accuracy: 0.0001)
        let next = behavior.step(now: 1.2, run: true, mouse: nil)
        XCTAssertEqual(next.lx, end.lx, accuracy: 0.0001)
        XCTAssertEqual(behavior.step(now: 1.9, run: true, mouse: nil).lx, -0.2, accuracy: 0.0001)
    }

    func testWorkingGazeAndMouseReleaseStartWithoutJump() {
        let working = OrbiBehavior(random: { lower, _ in lower })
        working.setMood(.working)
        // Consti 05.11.: Augen-Sprung als Feder – nach 0,1 s fast da, kurz über das Ziel hinaus, nach 0,55 s ruhig am Ziel.
        let start = working.step(now: 0, run: true, mouse: nil)
        var lowest = start.lx
        var early = start
        for frame in 1...33 {
            let pose = working.step(now: Double(frame) / 60, run: true, mouse: nil)
            lowest = min(lowest, pose.lx)
            if frame == 6 { early = pose }
        }
        XCTAssertLessThan(early.lx, start.lx + (-0.9 - start.lx) * 0.6)
        XCTAssertLessThan(lowest, -0.9)          // leichtes Nachschwingen
        XCTAssertGreaterThan(lowest, -1.0)       // aber kein Wackeln
        let end = working.step(now: 34.0 / 60, run: true, mouse: nil)
        XCTAssertEqual(end.lx, -0.9, accuracy: 0.02)
        XCTAssertEqual(end.ly, -0.6, accuracy: 0.02)
        let selected = OrbiBehavior(random: { lower, _ in lower })
        selected.setMood(.selected)
        _ = selected.step(now: 0, run: true, mouse: nil)
        let hover = selected.step(now: 0.4, run: true, mouse: CGPoint(x: 1, y: 0))
        let release = selected.step(now: 0.45, run: true, mouse: nil)
        XCTAssertEqual(release.lx, hover.lx, accuracy: 0.0001)
        XCTAssertEqual(release.tilt, hover.tilt, accuracy: 0.0001)
        let still = OrbiBehavior.still(.working)
        XCTAssertEqual(still.lx, 0); XCTAssertEqual(still.ly, 0); XCTAssertEqual(still.blink, 0)
    }


    func testDoneFirstHopRespectsBothFigmaIntervalBounds() {
        for chooseUpper in [false, true] {
            let behavior = OrbiBehavior(random: { lower, upper in chooseUpper ? upper : lower })
            behavior.setMood(.done)
            let interval = chooseUpper ? 1.9 : 1.3
            var before: [Double] = []
            var after: [Double] = []
            for frame in 0...500 {
                let time = Double(frame) / 100
                let pose = behavior.step(now: time, run: true, mouse: nil)
                if time >= 2.8 && time < 2.3 + interval { before.append(abs(pose.y)) }
                if time >= 2.3 + interval && time < 2.3 + interval + 0.3 { after.append(abs(pose.y)) }
            }
            XCTAssertLessThan(before.max() ?? .infinity, 0.2, "Kein früher Hüpfer bei Intervall \(interval)")
            XCTAssertGreaterThan(after.max() ?? 0, 5, "Hüpfer beginnt nach Intervall \(interval)")
        }
        let still = OrbiBehavior.still(.done)
        XCTAssertEqual(still.y, 0)
        XCTAssertTrue(still.sparks.isEmpty)
    }

    func testLeavingDoneClearsStatusAndSettlesTheWholePose() {
        for mood in [OrbiMood.idle, .head] {
            let behavior = OrbiBehavior(random: { lower, _ in lower })
            behavior.setMood(.done)
            for frame in 0...300 { _ = behavior.step(now: Double(frame) / 100, run: true, mouse: nil) }
            let done = behavior.pose
            XCTAssertGreaterThan(done.dot, 0.9)
            behavior.setMood(mood)
            let first = behavior.step(now: 3.01, run: true, mouse: nil)
            XCTAssertLessThan(first.dot, done.dot)
            XCTAssertGreaterThan(first.dot, 0)
            XCTAssertFalse(first.badge)
            XCTAssertFalse(behavior.settled)
            for frame in 302...700 { _ = behavior.step(now: Double(frame) / 100, run: true, mouse: nil) }
            XCTAssertEqual(behavior.pose.dot, 0, accuracy: 0.001)
            XCTAssertEqual(behavior.pose.es, 1, accuracy: 0.001)
            XCTAssertEqual(behavior.pose.x, 0, accuracy: 0.001)
            XCTAssertEqual(behavior.pose.y, 0, accuracy: 0.001)
        }
    }

    func testWorkingJumpsAtEightAndBackflipsAtEighteenSeconds() {
        let behavior = OrbiBehavior(random: { lower, _ in lower })
        behavior.setMood(.working)
        var atEight = OrbiPose(), atEighteen = OrbiPose()
        for frame in 0...1_820 {
            let pose = behavior.step(now: Double(frame) / 100, run: true, mouse: nil)
            if frame == 810 { atEight = pose }
            if frame == 1_810 { atEighteen = pose }
        }
        XCTAssertGreaterThan(abs(atEight.flipY), 1)
        XCTAssertEqual(atEight.flipX, 0)
        XCTAssertGreaterThan(abs(atEighteen.flipX), 1)
        XCTAssertEqual(atEighteen.flipY, 0)
    }

}
