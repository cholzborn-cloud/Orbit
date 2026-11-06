import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-layout <web.json>`: rendert das Hauptfenster mit dem Chat „Karti“ der Testkopie in der Größe und im Aussehen der
// Web-Messung (plan/tools/measure-web.mjs) und vergleicht die Rahmen benannter Elemente mit den Web-Maßen, Toleranz 2 pt.
// Läuft nur gegen eine Datenbankkopie (ORBIT_DATA_DIR, ORBIT_FAKE_SANDBOX=1). JSON auf stdout, Exit 0 ohne Abweichung.
@MainActor
enum SelfTestLayout {
    struct Rect: Codable { var x, y, w, h: Double }
    struct WebSpec: Decodable {
        let scheme: String
        let size: [Double]
        let elements: [String: Rect?]
    }
    struct Row: Encodable {
        let name: String
        let web: Rect?
        let native: Rect?
        let delta: Rect?
        let ok: Bool
        let note: String?
    }

    static let tolerance = 2.0

    // Elemente, die nur relativ zu einem Anker verglichen werden: die Seitenleiste lässt Suche, „Geplant“ und Einstellungen weg
    // (4d/4e), darüber verschiebt sich alles um dieselbe Strecke.
    static let anchors: [String: String] = [
        "main-card": "main-card", "chat-row-0": "main-card", "chat-row-1": "main-card", "chat-row-2": "main-card",
    ]
    // Abweichungen mit Begründung (Plattformgrenzen); sie zählen nicht als Fehler, stehen aber im Bericht.
    static let limits: [String: String] = [
        "image": "bei schmalem Fenster ragt das Web-Bild 3 pt über die Spalte (Hover-Skalierung des Bildknopfs), nativ bleibt es in der Spalte",
        "approval-card": "Verfall-Zeile „Läuft in …“ (4b, im Web nicht vorhanden): +28 pt Höhe",
    ]
    // Antwort-Spalte: bei 900 pt breiten Fenstern läuft sie im Web um bis zu 5 pt nach links über (Karte 448 + Figur 32 + Abstand > 80 % der
    // Spalte; die Zeile wächst über ihre Höchstbreite). Nativ bleibt die Spalte bei 80 %; Abweichung in x und w, begründet und benannt.
    static let columnItems: Set<String> = ["ask-card", "bubble-assistant", "error-card", "handoff-card", "jev-block", "search-card", "tool-row"]
    static let narrowOverflow = "Web: Antwort-Spalte läuft bei 900 pt um bis zu 5 pt über die 80 %-Breite (Karte 448 + Figur 32 + Abstand); nativ bleibt sie darin"

    // Die Verfall-Zeile der Freigabekarte schiebt alles darunter um diese Höhe (Abstand 12 + Zeile 16).
    static let approvalExtra = 28.0

    static func run(arguments: [String]) async -> Int32 {
        let positional = arguments.drop { $0 != "--selftest-layout" }.dropFirst().filter { !$0.hasPrefix("--") }
        guard let path = positional.first else {
            FileHandle.standardError.write(Data("Aufruf: Orbit --selftest-layout <web.json>\n".utf8))
            return 1
        }
        let model = AppModel()
        defer { model.shutdown() }
        do {
            guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
                throw SpikeError("Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1.")
            }
            let spec = try JSONDecoder().decode(WebSpec.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
            await model.start()
            let name = ProcessInfo.processInfo.environment["ORBIT_SCREEN_BOT"] ?? "Karti"
            guard let bot = model.botStore.orbis.first(where: { $0.name == name }) else { throw SpikeError("Orbi „\(name)“ fehlt in der Kopie.") }
            model.selection = .bot(bot.id)
            let session = model.chatStore.session(for: bot.chatId)
            await session.load()
            await session.waitUntilIdle()
            // Die Freigabe der Testdaten ist dem Dienst unbekannt; wie im Web steht sie offen da.
            let now = Date.now.timeIntervalSince1970 * 1000
            model.events.apply(Data("{\"type\":\"approval\",\"status\":\"pending\",\"id\":\"seed-appr-1\",\"kind\":\"approval\",\"chatId\":\"\(bot.chatId)\",\"botId\":\"\(bot.id)\",\"toolCallId\":\"t-appr\",\"tool\":\"bash\",\"input\":{\"command\":\"ls -la ~/Dokumente\",\"apiKey\":\"geheim-123\"},\"requestedAt\":\(now),\"expiresAt\":\(now + 86_400_000)}".utf8))

            // Gleiche Szene wie die Web-Messung (z. B. „panel“: rechtes Panel offen).
            if let action = ProcessInfo.processInfo.environment["ORBIT_SCREEN_ACTION"] { ScreenshotActions.apply(action, model: model) }
            let size = CGSize(width: spec.size[0], height: spec.size[1])
            let box = FrameBox()
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: spec.scheme == "light" ? .aqua : .darkAqua)
            let root = MainWindow(model: model)
                .environment(\.layoutProbing, true)
                .environment(\.figuresStatic, true)
                .onPreferenceChange(LayoutFrames.self) { box.frames = $0 }
            let host = NSHostingView(rootView: AnyView(root))
            window.contentView = host
            window.alphaValue = 0
            window.orderFrontRegardless()
            try await Task.sleep(for: .seconds(3))
            window.orderOut(nil)

            var rows: [Row] = []
            let native = box.frames
            func rect(_ r: CGRect) -> Rect { Rect(x: r.minX, y: r.minY, w: r.width, h: r.height) }
            func origin(_ name: String, web: Bool) -> (Double, Double) {
                if web, let r = spec.elements[name] ?? nil { return (r.x, r.y) }
                if !web, let r = native[name] { return (r.minX, r.minY) }
                return (0, 0)
            }
            for (name, webRect) in spec.elements.sorted(by: { $0.key < $1.key }) {
                guard let webRect else { rows.append(Row(name: name, web: nil, native: native[name].map(rect), delta: nil, ok: true, note: "im Web nicht gefunden")); continue }
                if name == "window" {
                    let ok = abs(host.bounds.width - webRect.w) <= tolerance && abs(host.bounds.height - webRect.h) <= tolerance
                    rows.append(Row(name: name, web: webRect, native: Rect(x: 0, y: 0, w: host.bounds.width, h: host.bounds.height), delta: nil, ok: ok, note: nil))
                    continue
                }
                guard let found = native[name] else { rows.append(Row(name: name, web: webRect, native: nil, delta: nil, ok: false, note: "nativ nicht gefunden")); continue }
                let n = rect(found)
                let anchor = anchors[name]
                let (wx, wy) = anchor.map { origin($0, web: true) } ?? (0, 0)
                let (nx, ny) = anchor.map { origin($0, web: false) } ?? (0, 0)
                var delta = Rect(x: (n.x - nx) - (webRect.x - wx), y: (n.y - ny) - (webRect.y - wy), w: n.w - webRect.w, h: n.h - webRect.h)
                // Nur die Karten unter der Freigabekarte verschieben sich um deren Verfall-Zeile.
                if let approval = native["approval-card"], n.y > approval.minY, n.x > 304, !name.hasPrefix("composer") { delta.y -= approvalExtra }
                if name == "approval-card" { delta.h -= approvalExtra }
                // Begründete Bildgrenze: Karten unter dem Bild verschieben sich um dessen Höhenunterschied.
                if let image = native["image"], let webImage = spec.elements["image"] ?? nil, n.y > image.minY, n.x > 304, !name.hasPrefix("composer") {
                    delta.y -= image.height - webImage.h
                }
                let within = [delta.x, delta.y, delta.w, delta.h].allSatisfy { abs($0) <= tolerance }
                var limit = limits[name]
                if spec.size[0] <= 900, columnItems.contains(name), abs(delta.x) <= 5, delta.x > 0, abs(delta.w) <= 14, abs(delta.y) <= tolerance, abs(delta.h) <= tolerance { limit = narrowOverflow }
                rows.append(Row(name: name, web: webRect, native: n, delta: delta, ok: within || limit != nil, note: within ? anchor.map { "relativ zu \($0)" } : limit))
            }
            if let column = native["chat-column"], let composer = native["composer"], let pill = native["header-pill"] {
                let edges = max(abs(column.minX - composer.minX), abs(column.maxX - composer.maxX))
                let center = abs(column.midX - pill.midX)
                rows.append(Row(name: "spalte-eingabe", web: nil, native: rect(composer), delta: nil, ok: edges <= 0.5, note: "Kantenabstand \(edges) pt"))
                rows.append(Row(name: "spalte-kopf", web: nil, native: rect(pill), delta: nil, ok: center <= 1, note: "Mittenabstand \(center) pt"))
            } else {
                rows.append(Row(name: "spalte-eingabe-kopf", web: nil, native: nil, delta: nil, ok: false, note: "Messpunkte fehlen"))
            }
            for name in ["bubble-user", "bubble-assistant"] {
                if let bubble = native[name], let column = native["chat-column"] {
                    let limit = column.width * Theme.Layout.messageShare
                    rows.append(Row(name: "\(name)-maximum", web: nil, native: rect(bubble), delta: nil, ok: bubble.width <= limit + 0.5, note: "Höchstbreite \(limit) pt"))
                }
            }
            struct Report: Encodable { let ok: Bool; let scheme: String; let size: [Double]; let abweichungen: Int; let elements: [Row] }
            let bad = rows.filter { !$0.ok }.count
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            print(String(decoding: try encoder.encode(Report(ok: bad == 0, scheme: spec.scheme, size: spec.size, abweichungen: bad, elements: rows)), as: UTF8.self))
            return bad == 0 ? 0 : 1
        } catch {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"\(error.localizedDescription)\"}\n".utf8))
            return 1
        }
    }

    final class FrameBox: @unchecked Sendable { var frames: [String: CGRect] = [:] }
}

final class SelfTestLayoutDelegate: NSObject, NSApplicationDelegate {
    private let arguments: [String]
    init(arguments: [String]) { self.arguments = arguments }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = arguments
        Task { @MainActor in exit(await SelfTestLayout.run(arguments: arguments)) }
    }
}
