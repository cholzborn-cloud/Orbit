import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-scroll`: Chat „Karti“ der Testkopie in einem unsichtbaren Fenster. Mausrad-Ereignisse scrollen den Verlauf;
// geprüft werden: der Kopf rastet ein (groß 50 oder klein 36, nie dazwischen), „Nach ganz unten“ erscheint beim Hochscrollen und
// verschwindet beim Klick, eine neue eigene Nachricht scrollt nach unten. Nur gegen eine Datenbankkopie.
@MainActor
enum SelfTestScroll {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }

    static func run() async -> Int32 {
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String = "") { checks.append(Check(name: name, ok: ok, detail: detail)) }
        let model = AppModel()
        defer { model.shutdown() }
        do {
            guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
                throw SpikeError("Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1.")
            }
            await model.start()
            let name = ProcessInfo.processInfo.environment["ORBIT_SCREEN_BOT"] ?? "Karti"
            guard let bot = model.botStore.orbis.first(where: { $0.name == name }) else { throw SpikeError("Orbi „\(name)“ fehlt in der Kopie.") }
            model.selection = .bot(bot.id)
            let session = model.chatStore.session(for: bot.chatId)
            await session.load()
            await session.waitUntilIdle()
            session.model = ProcessInfo.processInfo.environment["ORBIT_TEST_MODEL"] ?? "claude-haiku-5-5"
            session.effort = "low"

            let size = CGSize(width: 1100, height: 640)
            let box = FrameBox()
            let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: 200, y: 200), size: size), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: .darkAqua)
            let root = MainWindow(model: model)
                .environment(\.layoutProbing, true)
                .environment(\.figuresStatic, true)
                .onPreferenceChange(LayoutFrames.self) { box.frames = $0 }
            window.contentView = NSHostingView(rootView: AnyView(root))
            window.alphaValue = 0.01   // 0 wäre für Mausereignisse durchlässig
            window.makeKeyAndOrderFront(nil)
            try await Task.sleep(for: .seconds(3))

            func avatar() -> Double { Double(box.frames["header-avatar"]?.width ?? 0) }
            func button() -> CGRect? { box.frames["scroll-bottom"] }
            func wheel(_ dy: Int32) async {
                // Mausrad ohne Phase (wie eine Maus): in der Mitte des Verlaufs.
                // Ein Ereignis ohne Fenster (Fenster 0) trägt die Bildschirmposition als „Position im Fenster“: so wählen, dass sie dem Punkt
                // in der Mitte des Verlaufs im Inhalt des Testfensters entspricht, egal welches andere Fenster dort liegt.
                let inWindow = CGPoint(x: 700, y: size.height / 2)
                if let cg = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0) {
                    cg.location = CGPoint(x: inWindow.x, y: (NSScreen.screens.first?.frame.height ?? 0) - inWindow.y)
                    if let event = NSEvent(cgEvent: cg) {
                        window.sendEvent(event)
                    }
                }
                try? await Task.sleep(for: .milliseconds(30))
            }
            func scroll(_ total: Int32) async {
                var rest = total
                while rest != 0 { let step = max(-100, min(100, rest)); await wheel(step); rest -= step }
            }

            check("Start: unten, Kopf klein, kein Knopf", button() == nil && abs(avatar() - 36) < 1.5, "Figur \(avatar()), Knopf \(button() != nil)")
            // Der Verlauf springt beim Laden einmal nach unten; Hochscrollen daher bis zu fünfmal wiederholen.
            for _ in 0..<5 {
                await scroll(3000)
                try await Task.sleep(for: .milliseconds(700))
                if abs(avatar() - 50) < 1.5 { break }
            }
            check("Hochgescrollt: Kopf groß, Knopf „Nach ganz unten“ da", abs(avatar() - 50) < 1.5 && button() != nil, "Figur \(avatar()), Knopf \(button() != nil)")

            // Mitte loslassen: ein kurzer Schritt nach unten, dann muss der Kopf von selbst einrasten (Mausrad = keine Geste).
            for dy: Int32 in [-40, 20, -70] {
                await scroll(dy)
                try await Task.sleep(for: .milliseconds(100))
                let mid = avatar()
                try await Task.sleep(for: .seconds(1))
                let rested = avatar()
                check("Kopf rastet ein (nie dazwischen) nach \(dy) pt", abs(rested - 50) < 1.5 || abs(rested - 36) < 1.5, "mitten \(String(format: "%.1f", mid)), danach \(String(format: "%.1f", rested))")
            }

            await scroll(3000)
            try await Task.sleep(for: .seconds(1))
            session.send("Sag nur Hallo.")
            let sent = await wait(30) { !(box.frames["scroll-bottom"] != nil) }
            check("Neue Nachricht: scrollt nach unten, Knopf weg", sent, "Knopf \(button() != nil)")
            while session.isRunning { try await Task.sleep(for: .milliseconds(200)) }

            await scroll(3000)
            try await Task.sleep(for: .seconds(1))
            let wasThere = button() != nil
            if let frame = button() {
                // Klick auf den Knopf (Fenstermitte des Knopfs in Bildschirmkoordinaten).
                let inWindow = NSPoint(x: frame.midX, y: size.height - frame.midY)
                for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                    if let event = NSEvent.mouseEvent(with: type, location: inWindow, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
                        window.sendEvent(event)
                    }
                    try await Task.sleep(for: .milliseconds(60))
                }
            }
            let gone = await wait(5) { button() == nil }
            check("Knopf „Nach ganz unten“ scrollt ans Ende", wasThere && gone, "da \(wasThere), danach weg \(gone)")
        } catch {
            check("Ablauf", false, error.localizedDescription)
        }
        struct Report: Encodable { let ok: Bool; let checks: [Check] }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(Report(ok: checks.allSatisfy(\.ok), checks: checks)) { print(String(decoding: data, as: UTF8.self)) }
        return checks.allSatisfy(\.ok) ? 0 : 1
    }

    private final class FrameBox: @unchecked Sendable { var frames: [String: CGRect] = [:] }

    private static func wait(_ timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline { if condition() { return true }; try? await Task.sleep(for: .milliseconds(50)) }
        return condition()
    }
}

final class SelfTestScrollDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestScroll.run()) }
    }
}
