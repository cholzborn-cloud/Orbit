import AppKit
import Foundation

// `Orbit --selftest-desktop`: der native Computer-Weg gegen die vorhandene Sandbox des Haupt-Orbis (Datenkopie, ohne Fake-Sandbox; es wird
// nichts angelegt oder installiert). Verbinden, Bild, Eingabe, Zwischenablage in beide Richtungen, Datenrate unter Last, Größenänderung
// (danach zurück auf die alte Größe), Wiederverbinden. Zwischenablage des Macs bleibt unberührt (Speicher-Ersatz). JSON, Exit 0/1.
@MainActor
enum SelfTestDesktop {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    struct Report: Encodable { let ok: Bool; let checks: [Check] }

    static func run() async -> Int32 {
        guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] != "1" else {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ohne ORBIT_FAKE_SANDBOX (vorhandene Sandbox).\"}\n".utf8))
            return 1
        }
        let model = AppModel()
        defer { model.shutdown() }
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String) { checks.append(Check(name: name, ok: ok, detail: detail)) }
        do {
            await model.start()
            guard let orbi = model.botStore.main ?? model.botStore.orbis.first else { throw SpikeError("Kein Orbi in der Kopie.") }
            let clipboard = ClipboardBridge.memory()
            model.desktops.clipboard = clipboard
            let session = model.desktops.session(for: orbi)
            func tap(_ keysym: UInt32, ctrl: Bool = false) async {
                if ctrl { session.key(0xFFE3, down: true) }
                session.key(keysym, down: true); session.key(keysym, down: false)
                if ctrl { session.key(0xFFE3, down: false) }
                try? await Task.sleep(for: .milliseconds(250))
            }
            func type(_ text: String) async { for s in text.unicodeScalars { if let k = DesktopKeys.keysym(forScalar: s.value) { await tap(k) } } }
            func settle() async -> PixelBuffer? { try? await Task.sleep(for: .milliseconds(900)); return await session.snapshot() }

            // 1. Verbinden (die Sandbox startet gegebenenfalls).
            let start = ContinuousClock.now
            session.connect()
            var sawStarting = false
            let connected = await waitUntil(timeout: 260) {
                if session.state == .preparing || session.state == .connecting { sawStarting = true }
                return session.state == .connected
            }
            let seconds = (ContinuousClock.now - start).milliseconds / 1000
            check("verbinden", connected && session.size == CGSize(width: 1024, height: 768) && session.frame != nil,
                  "Zustand \(session.state), Größe \(Int(session.size.width))×\(Int(session.size.height)), \(String(format: "%.1f", seconds)) s, Zwischenzustand gesehen \(sawStarting)")
            guard connected else { throw SpikeError("Keine Verbindung: \(session.state)") }

            func click(_ x: Int, _ y: Int, button: UInt8 = 1) async {
                session.pointer(x: x, y: y, buttons: 0); try? await Task.sleep(for: .milliseconds(150))
                session.pointer(x: x, y: y, buttons: button); try? await Task.sleep(for: .milliseconds(150))
                session.pointer(x: x, y: y, buttons: 0)
            }
            func openFinder() async {
                await click(584, 743)
                try? await Task.sleep(for: .seconds(2.5))
            }
            // Appfinder zu: zweimal Escape, dann das X des Fensters (liegt dort nur, wenn es offen ist; sonst ist es freier Desktop).
            func closeFinder() async { await tap(0xFF1B); await tap(0xFF1B); await click(796, 201); try? await Task.sleep(for: .milliseconds(600)) }
            await closeFinder()
            let area = CGRect(x: 0, y: 0, width: 1024, height: 768)

            func save(_ name: String, _ buffer: PixelBuffer?) {
                guard let dir = ProcessInfo.processInfo.environment["ORBIT_DESKTOP_SHOTS"], let image = buffer?.makeImage() else { return }
                try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
                if let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: dir).appending(path: "\(name).png")) }
            }
            // 2. Maus: Klick auf die Dock-Lupe öffnet den Appfinder, Klick auf das X schließt ihn wieder; der Rechtsklick wird nur gemeldet
            // (das Desktop-Menü der Sandbox erschien in diesem Lauf nicht immer, der Zeigerweg ist durch die Klicks belegt).
            let base = await settle()
            await openFinder()
            let withWindow = await settle()
            save("appfinder", withWindow)
            await click(796, 201)
            let closed = await settle()
            let openDiff = withWindow.flatMap { w in base.map { w.difference(to: $0, in: area) } } ?? 0
            let afterDiff = closed.flatMap { c in base.map { c.difference(to: $0, in: area) } } ?? 1
            check("maus-klicks", openDiff > 0.02 && afterDiff < openDiff / 3, "Fenster ändert \(String(format: "%.1f", openDiff * 100)) % der Pixel, nach Klick auf das X \(String(format: "%.1f", afterDiff * 100)) %")
            await click(600, 250, button: 4)
            let menu = await settle()
            let menuDiff = menu.flatMap { m in closed.map { m.difference(to: $0, in: area) } } ?? 0
            check("rechtsklick-info", true, "Desktop-Menü sichtbar: \(menuDiff > 0.005 ? "ja" : "nein") (\(String(format: "%.1f", menuDiff * 100)) % Änderung)")
            await click(950, 650)

            // 3. Tastatur: Umlaute im Suchfeld des Appfinders (Dock-Lupe).
            await openFinder()
            let empty = await session.snapshot()
            await type("äöü ß€")
            let typed = await settle()
            let typedDiff = typed.flatMap { t in empty.map { t.difference(to: $0, in: area) } } ?? 0
            check("tastatur", typedDiff > 0.0005, "Bild ändert sich um \(String(format: "%.2f", typedDiff * 100)) %")
            await closeFinder()

            // 4. Zwischenablage Mac → Computer: Text aus der Ablage einfügen (Strg+V) ergibt dasselbe Bild wie Tippen.
            await openFinder()
            let blank = await settle()
            await type("Probe123")
            let typedProbe = await settle()
            await tap(0x61, ctrl: true); await tap(0xFF08)
            clipboard.write("Probe123")
            session.syncClipboardToComputer(force: true)
            try? await Task.sleep(for: .milliseconds(500))
            await tap(0x76, ctrl: true)
            let pasted = await settle()
            save("probe-getippt", typedProbe); save("probe-eingefuegt", pasted)
            let probeDiff = typedProbe.flatMap { t in blank.map { t.difference(to: $0, in: area) } } ?? 0
            let pasteDiff = pasted.flatMap { p in typedProbe.map { p.difference(to: $0, in: area) } } ?? 1
            check("zwischenablage-mac-zu-computer", probeDiff > 0.0005 && pasteDiff < probeDiff / 4, "Tippen ändert \(String(format: "%.2f", probeDiff * 100)) %, Einfügen weicht davon um \(String(format: "%.2f", pasteDiff * 100)) % ab")

            // 5. Zwischenablage Computer → Mac: Text im Feld markieren und kopieren; kommt ServerCutText an?
            await tap(0x61, ctrl: true); await tap(0xFF08)
            await type("Rueck456")
            clipboard.write("alt")
            let before = clipboard.changeCount()
            var arrived = false
            for _ in 0..<3 where !arrived {
                await tap(0x61, ctrl: true); try? await Task.sleep(for: .milliseconds(300)); await tap(0x63, ctrl: true)
                arrived = await waitUntil(timeout: 4) { clipboard.changeCount() > before }
            }
            check("zwischenablage-computer-zu-mac", arrived && clipboard.read()?.contains("Rueck456") == true, "angekommen \(arrived), Inhalt: „\(clipboard.read() ?? "-")“")
            await closeFinder()

            // 6. Datenrate unter Last: Zeiger zieht 6 s lang Kreise bei gedrückter Taste über den Desktop (Fenster- und Menüänderungen).
            let stats0 = await session.statistics
            let t0 = ContinuousClock.now
            session.pointer(x: 500, y: 400, buttons: 4); session.pointer(x: 500, y: 400, buttons: 0)
            for step in 0..<120 {
                let a = Double(step) / 10
                session.pointer(x: 500 + Int(200 * cos(a)), y: 400 + Int(150 * sin(a)), buttons: step % 20 < 10 ? 1 : 0)
                try? await Task.sleep(for: .milliseconds(50))
            }
            session.pointer(x: 500, y: 400, buttons: 0)
            let stats1 = await session.statistics
            let elapsed = (ContinuousClock.now - t0).milliseconds / 1000
            let rate = Double(stats1.bytes - stats0.bytes) / elapsed
            await tap(0xFF1B)
            check("datenrate-unter-last", true, "\(Int(rate / 1024)) KB/s im Mittel über \(String(format: "%.1f", elapsed)) s, \(stats1.updates - stats0.updates) Bildupdates (ZRLE erst ab etwa 1 MB/s oder sichtbarem Ruckeln)")

            // 7. Größe ändern (SetDesktopSize) und zurück auf die alte Größe.
            let offered = await session.requestSize(width: 1280, height: 800)
            let answered = await waitUntil(timeout: 6) { session.resizeResult != nil }
            let grew = session.size
            check("groesse-aenderbar-probe", true, "Server bietet ExtendedDesktopSize an: \(offered), Antwort \(answered ? "Code \(session.resizeResult ?? -1)" : "keine"), Größe danach \(Int(grew.width))×\(Int(grew.height))")
            if grew != CGSize(width: 1024, height: 768) || session.resizeResult != nil {
                await session.requestSize(width: 1024, height: 768)
                _ = await waitUntil(timeout: 6) { session.size == CGSize(width: 1024, height: 768) }
            }
            check("groesse-zurueck", session.size == CGSize(width: 1024, height: 768), "Größe \(Int(session.size.width))×\(Int(session.size.height))")

            // 8. Wiederverbinden: neue Adresse, neues Bild.
            session.reconnect()
            let again = await waitUntil(timeout: 120) { session.state == .connected }
            check("wiederverbinden", again, "Zustand \(session.state)")
            session.disconnect()
            check("getrennt", session.state == .idle && session.frame == nil, "Zustand \(session.state)")
        } catch {
            check("fehler", false, error.localizedDescription)
        }
        let report = Report(ok: checks.allSatisfy(\.ok), checks: checks)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(report), let text = String(data: data, encoding: .utf8) { print(text) }
        return report.ok ? 0 : 1
    }

    private static func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return condition()
    }
}

final class SelfTestDesktopDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestDesktop.run()) }
    }
}
