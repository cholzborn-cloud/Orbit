import AppKit
import Foundation

// `Orbit --screenshot-4e <Ordner> <Szene>`: Bilder für Block 4e (1280 × 800, hell und dunkel, unsichtbar), nur gegen eine Datenbankkopie.
// Szenen: suche, suche-keine, palette, palette-suche,
// computer-startet, computer-fehler, computer-getrennt, computer-ohne, computer (live), computer-vollbild (live). Dateien: mac4e-<Szene>-<dark|light>.png
@MainActor
enum ScreenshotTools {
    static func run(directory: String, scene: String) async -> Int32 {
        guard TestDatabase.isTestCopy else { return 1 }
        let model = AppModel()
        defer { model.shutdown() }
        await model.start()
        guard let orbi = model.botStore.main ?? model.botStore.orbis.first else { return 1 }
        let size = CGSize(width: 1280, height: 800)
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            var settle = 1.5
            if scene.hasPrefix("computer") {
                model.selection = .bot(orbi.id)
                await model.chatStore.session(for: orbi.chatId).load()
                model.panelWidth = AppModel.panelDefaultWidth
                if !model.panelOpen { model.togglePanel() }
                let session = model.desktops.session(for: orbi)
                model.screenTab = "desktop"
                switch scene {
                case "computer-startet": session.simulate(state: .preparing)
                case "computer-fehler": session.simulate(state: .failed("Der Computer antwortet nicht."))
                case "computer-getrennt": session.simulate(state: .disconnected("Die Verbindung zum Computer wurde beendet.", retryIn: nil))
                case "computer-ohne": session.simulate(state: .noComputer("Dieser Orbi hat keinen Computer."))
                default:
                    session.activate()
                    for _ in 0..<600 where session.state != .connected { try await Task.sleep(for: .milliseconds(100)) }
                    if scene == "computer-vollbild" { model.desktopFullscreen = orbi.id }
                    settle = 2
                }
            } else {
                guard scene.hasPrefix("suche") || scene.hasPrefix("palette") else { return 1 }
                model.selection = .bot(orbi.id)
            }
            switch scene {
            case "suche", "palette-suche":
                model.search.query = "Quarkkuchen"
                for _ in 0..<80 where model.search.results.isEmpty { try await Task.sleep(for: .milliseconds(100)) }
                if scene == "palette-suche" { model.search.paletteOpen = true }
            case "suche-keine":
                model.search.query = "zzqxnichtda"
                for _ in 0..<80 where !model.search.emptyResult { try await Task.sleep(for: .milliseconds(100)) }
            case "palette": model.search.paletteOpen = true
            default: break
            }
            try await ScreenshotMode.capture(model, directory: directory, prefix: "mac4e-\(scene)", settle: settle, size: size)
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}

final class ScreenshotToolsDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    private let scene: String
    init(directory: String, scene: String) { self.directory = directory; self.scene = scene }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory, scene = scene
        Task { @MainActor in exit(await ScreenshotTools.run(directory: directory, scene: scene)) }
    }
}
