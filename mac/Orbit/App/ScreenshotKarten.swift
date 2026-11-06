import AppKit
import SwiftUI

// `Orbit --screenshot-karten <Ordner> <verlauf>`: rendert das Hauptfenster mit dem Chat „Karti“ (Karten-Verlauf der Testkopie),
// Dunkel und Hell, unsichtbar ohne Dock-Symbol. Nur gegen eine Datenbankkopie (ORBIT_DATA_DIR, ORBIT_FAKE_SANDBOX=1).
@MainActor
enum ScreenshotKarten {
    static func run(directory: String, scenario: String) async -> Int32 {
        let model = AppModel()
        defer { model.shutdown() }
        do {
            guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
                throw SpikeError("Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1.")
            }
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            await model.start()
            let name = ProcessInfo.processInfo.environment["ORBIT_SCREEN_BOT"] ?? "Karti"
            // ORBIT_SCREEN_GROUP wählt eine Gruppe statt eines Orbis.
            let chatId: String
            if let groupName = ProcessInfo.processInfo.environment["ORBIT_SCREEN_GROUP"] {
                guard let group = model.botStore.groups.first(where: { $0.name == groupName }) else { throw SpikeError("Gruppe „\(groupName)“ fehlt in der Kopie.") }
                model.selection = .group(group.id)
                chatId = group.id
            } else {
                guard let bot = model.botStore.orbis.first(where: { $0.name == name }) else { throw SpikeError("Orbi „\(name)“ fehlt in der Kopie.") }
                model.selection = .bot(bot.id)
                chatId = bot.chatId
            }
            let session = model.chatStore.session(for: chatId)
            await session.load()
            // Live-Szenen (offene Freigabe, laufende Übergabe): der Turn endet nicht, nur die Wiedergabe abwarten.
            if ProcessInfo.processInfo.environment["ORBIT_SCREEN_LIVE"] == "1" { try await Task.sleep(for: .seconds(2)) } else { await session.waitUntilIdle() }
            // Szene mit offenem Menü/Panel/Dialog (4g): ORBIT_SCREEN_ACTION.
            if let action = ProcessInfo.processInfo.environment["ORBIT_SCREEN_ACTION"] { ScreenshotActions.apply(action, model: model) }
            let width = Double(ProcessInfo.processInfo.environment["ORBIT_SCREEN_WIDTH"] ?? "") ?? 1100
            let height = Double(ProcessInfo.processInfo.environment["ORBIT_SCREEN_HEIGHT"] ?? "") ?? 3200
            let progress = ProcessInfo.processInfo.environment["ORBIT_PANEL_PROGRESS"].flatMap(Double.init)
            try await ScreenshotOrbis.capture(MainWindow(model: model).environment(\.panelProgress, progress), size: CGSize(width: width, height: height), directory, "\(ProcessInfo.processInfo.environment["ORBIT_SCREEN_PREFIX"] ?? "mac4b")-\(scenario)", settle: 2, borderless: true)
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}

// Benannte Zustände für Screenshots Web neben nativ (plan/archiv/PARITY.md).
@MainActor
enum ScreenshotActions {
    static func apply(_ action: String, model: AppModel) {
        model.screenAction = action
        switch action {
        case "dialog-bot": model.sheet = .newBot
        case "dialog-group": model.sheet = .newGroup
        case "panel": model.panelOpen = true
        case "collapse": model.sidebarCollapsed = true
        case "alert-clear", "alert-delete":
            // Wie im Web aus dem offenen Panel heraus.
            model.panelOpen = true
            if case .bot(let id) = model.selection, let bot = model.botStore.bot(id: id) {
                model.botStore.requestDelete(action == "alert-clear" ? .clear(chatId: bot.chatId, name: bot.name, group: false) : .bot(bot))
            }
        default: break
        }
    }
}

final class ScreenshotKartenDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    private let scenario: String
    init(directory: String, scenario: String) { self.directory = directory; self.scenario = scenario }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory, scenario = scenario
        Task { @MainActor in exit(await ScreenshotKarten.run(directory: directory, scenario: scenario)) }
    }
}
