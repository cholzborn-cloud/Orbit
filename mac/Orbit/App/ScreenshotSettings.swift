import AppKit
import SwiftUI

// `Orbit --screenshot-einstellungen <Ordner> <Szene>`: rendert das Einstellungsfenster (768 × 576) hell und dunkel, unsichtbar.
// Szene = Reiter (usage, jev, orbis, skills, connectors, approvals, marketplace, appearance), optional mit Zusatz:
// `-fehler`, `-offline` (Dienst nicht erreichbar), `-leer`, `-laedt`, `-lang` (60 Einträge), `-ohne-daten` (Nutzung), `-bearbeiten` (Konnektor-Dialog).
// Nur gegen eine Datenbankkopie. Dateien: mac4d-<Szene>-<dark|light>.png
@MainActor
enum ScreenshotSettings {
    // Limit-Zustand der Figuren: Orbi im Limit, Rücksetzzeit in zwei Stunden („wartet bis …“ in Seitenleiste und Kopf).
    private static func limitScene(_ model: AppModel, directory: String) async -> Int32 {
        guard let orbi = model.botStore.orbis.first else { return 1 }
        model.selection = .bot(orbi.id)
        let session = model.chatStore.session(for: orbi.chatId)
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            await session.load()
            await session.waitUntilIdle()
            await session.composer.loadCatalog()
            session.simulate(error: "429 rate limit: Limit des Modells erreicht")
            let reset = Date().addingTimeInterval(7200)
            LimitStore.shared.simulate(resets: ["claude": reset, "codex": reset, "antigravity": reset])
            try await ScreenshotMode.capture(model, directory: directory, prefix: "mac4d-limit", settle: 1.5, size: CGSize(width: 1100, height: 720))
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    // Dialog „Neuer Skill“ aus dem Chat (`/skill neu mein-skill`).
    private static func newSkillScene(_ model: AppModel, directory: String) async -> Int32 {
        guard let orbi = model.botStore.orbis.first else { return 1 }
        model.selection = .bot(orbi.id)
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            await model.chatStore.session(for: orbi.chatId).load()
            model.newSkillName = "mein-skill"
            try await ScreenshotMode.capture(model, directory: directory, prefix: "mac4d-neuer-skill", settle: 1.5, size: CGSize(width: 1100, height: 720))
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    static func run(directory: String, scene: String) async -> Int32 {
        guard TestDatabase.isTestCopy else { return 1 }
        let model = AppModel()
        defer { model.shutdown() }
        await model.start()
        if scene == "limit" { return await limitScene(model, directory: directory) }
        if scene == "neuer-skill" { return await newSkillScene(model, directory: directory) }
        let parts = scene.split(separator: "-", maxSplits: 1).map(String.init)
        guard let section = SettingsSection(rawValue: parts[0]) else { return 1 }
        let variant = parts.count > 1 ? parts[1] : ""
        let store = model.settings
        store.section = section
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            await store.load(section)
            switch (section, variant) {
            case (_, "fehler"), (_, "offline"), (_, "leer"), (_, "laedt"), (_, "lang"), (_, "ohne-daten"): store.simulate(section, variant: variant)
            case (.connectors, _):
                for connector in store.connectors.value ?? [] { await store.test(connector.id) }
                if variant == "bearbeiten", let first = store.connectors.value?.first { store.editingConnector = first.id }
                if variant == "hinzufuegen" { store.connectorFormOpen = true }
            case (.skills, "formular"): store.skillFormOpen = true
            default: break
            }
            let size = SettingsView.size
            var windows: [(String, NSWindow, NSHostingView<AnyView>)] = []
            for (name, appearance) in [("dark", NSAppearance.Name.darkAqua), ("light", .aqua)] {
                let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable], backing: .buffered, defer: false)
                window.appearance = NSAppearance(named: appearance)
                let host = NSHostingView(rootView: AnyView(SettingsView(store: store)))
                window.contentView = host
                window.alphaValue = 0
                window.orderFrontRegardless()
                windows.append((name, window, host))
            }
            // Die Ansicht lädt beim Einblenden erneut; die Szene stellt danach ihren Zustand wieder her.
            try await Task.sleep(for: .seconds(1.2))
            if ["fehler", "offline", "leer", "laedt", "lang", "ohne-daten"].contains(variant) {
                store.simulate(section, variant: variant)
                try await Task.sleep(for: .seconds(0.4))
            }
            for (name, window, host) in windows {
                guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds), host.bounds.width > 0 else { throw ServiceError.invalidResponse }
                host.cacheDisplay(in: host.bounds, to: rep)
                guard let png = rep.representation(using: .png, properties: [:]) else { throw ServiceError.invalidResponse }
                try png.write(to: URL(fileURLWithPath: directory).appending(path: "mac4d-\(scene)-\(name).png"))
                window.orderOut(nil)
            }
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}

final class ScreenshotSettingsDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    private let section: String
    init(directory: String, section: String) { self.directory = directory; self.section = section }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory, section = section
        Task { @MainActor in exit(await ScreenshotSettings.run(directory: directory, scene: section)) }
    }
}
