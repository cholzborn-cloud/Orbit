import AppKit
import SwiftUI

// `Orbit --screenshot-cards <Ordner>`: jede Karte und kartenartige Zeile aus CardGallery in jedem Zustand, Dunkel und Hell,
// ohne Dienst und ohne Datenbank. Dateien karte-<name>-<dark|light>.png (2×), Abgleich mit plan/design/04-schritt4-karten.
final class ScreenshotCardsDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    init(directory: String) { self.directory = directory }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory
        Task { @MainActor in
            do {
                try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                var failed = ""
                let written = try SelfTestKarten.render(folder: URL(fileURLWithPath: directory), prefix: "karte") { _, ok, detail in if !ok { failed = detail } }
                print("\(written.count) Bilder in \(directory)")
                if !failed.isEmpty { FileHandle.standardError.write(Data("\(failed)\n".utf8)) }
                exit(failed.isEmpty ? 0 : 1)
            } catch {
                FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
    }
}
