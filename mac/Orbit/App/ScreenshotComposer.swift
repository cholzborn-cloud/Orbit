import AppKit
import Foundation

// `Orbit --screenshot-composer <Ordner> <Szene>`: rendert den Composer in einem Zustand hell und dunkel (1280 × 900, unsichtbar).
// Nur gegen eine Datenbankkopie (ORBIT_DATA_DIR). Szenen: basis, modus, modell, modell-liste, slash, anhang, fehler, plan, offline,
// kein-modell, lang, klein. Dateien: mac4c-<Szene>-<dark|light>.png
@MainActor
enum ScreenshotComposer {
    static func run(directory: String, scene: String) async -> Int32 {
        guard TestDatabase.isTestCopy else { return 1 }
        let model = AppModel()
        defer { model.shutdown() }
        await model.start()
        guard let orbi = model.botStore.orbis.first else { return 1 }
        model.selection = .bot(orbi.id)
        let session = model.chatStore.session(for: orbi.chatId)
        let composer = session.composer
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            await session.load()
            await session.waitUntilIdle()
            await composer.loadCatalog()
            var size = CGSize(width: 1280, height: 900)
            switch scene {
            case "modell": model.screenAction = "modell"
            case "modell-liste": model.screenAction = "modell-liste"
            case "modell-max":
                // Höchste Stufe: goldener Regler, goldene Zahl (Nachtrag 4d).
                if let top = composer.models.first(where: { $0.efforts.count > 1 && $0.efforts.last == "max" }) ?? composer.models.first(where: { $0.efforts.count > 1 }) {
                    composer.select(model: top.id); composer.setEffort(top.efforts.last ?? "max")
                }
                model.screenAction = "modell"
            case "modell-auto": composer.select(model: ModelInfo.autoId); model.screenAction = "modell"
            case "slash":
                await composer.reloadSkills()
                session.draft = "/"
            case "chip":
                // Skill gewählt: der Chip schwebt über dem Feld (Nachtrag 4d).
                await composer.reloadSkills()
                composer.skill = composer.skills.first
                session.draft = "Fasse das zusammen"
            case "anhang":
                composer.add(data: SelfTestComposer.makePNG(width: 600, height: 400), filename: "probe.png", mediaType: "image/png")
                composer.add(data: Data("Hallo".utf8), filename: "notiz.txt", mediaType: "text/plain")
                composer.add(data: Data(count: 1000), filename: "dokument.pdf", mediaType: "application/pdf")
                session.draft = "Was steht in den Dateien?"
            case "fehler":
                composer.add(data: Data(count: AttachmentRules.maxAddBytes + 1), filename: "riesig.bin", mediaType: "application/octet-stream")
            case "lang": session.draft = String(repeating: "Ein sehr langer Text über mehrere Zeilen im Eingabefeld. ", count: 40)
            case "klein": size = CGSize(width: 640, height: 520); session.draft = "Kurze Frage im kleinen Fenster"
            case "offline": composer.simulate(catalog: .failed(ServiceError.offline.localizedDescription), models: [], modelsAvailable: true)
            case "kein-modell": composer.simulate(catalog: .loaded, models: [], modelsAvailable: false)
            default: break
            }
            try await ScreenshotMode.capture(model, directory: directory, prefix: "mac4c-\(scene)", settle: 1.5, size: size)
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}

final class ScreenshotComposerDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    private let scene: String
    init(directory: String, scene: String) { self.directory = directory; self.scene = scene }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory, scene = scene
        Task { @MainActor in exit(await ScreenshotComposer.run(directory: directory, scene: scene)) }
    }
}
