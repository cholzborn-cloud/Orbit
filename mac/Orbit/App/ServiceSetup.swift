import AppKit
import Foundation

// `Orbit --dienst-einrichten` (von scripts/install.sh): richtet den Hintergrunddienst ein und wartet, bis er antwortet. Kein Fenster.
// `Orbit --dienst-entfernen` nimmt ihn wieder aus launchd. Beides arbeitet mit dem Dienst im Bündel der App, die es aufruft.
enum ServiceSetup {
    static func run(remove: Bool) async -> Int32 {
        let agent = LaunchAgent()
        if remove {
            agent.uninstall()
            print("Dienst entfernt (\(agent.label))")
            return 0
        }
        guard let spec = LaunchAgent.bundled() else {
            FileHandle.standardError.write(Data("Diese Orbit-Version enthält keinen Dienst (Bündel fehlt: scripts/install.sh baut sie mit).\n".utf8))
            return 1
        }
        do {
            let changed = try agent.install(spec)
            let client = ServiceClient()
            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                do {
                    try await client.health()
                    print("Dienst läuft (\(agent.label), \(changed ? "neu eingerichtet" : "unverändert"))")
                    return 0
                } catch ServiceError.noToken, ServiceError.offline { try await Task.sleep(for: .milliseconds(300)) }
            }
            FileHandle.standardError.write(Data("Dienst antwortet nicht. launchd: \(agent.isRunning ? "läuft" : "läuft nicht"). Log: \(spec.dataDirectory.appending(path: "orbitd-service.log").path)\n".utf8))
            return 1
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}

// `Orbit --menueleiste-bild <Ordner>`: schreibt das Menüleistensymbol in den drei Zuständen (ruhig, arbeitet, wartet) als PNG, hell auf dunkel.
enum MenuBarSnapshot {
    @MainActor static func run(directory: String) -> Int32 {
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for (name, working, waiting) in [("ruhig", false, false), ("arbeitet", true, false), ("wartet", false, true)] {
            let icon = MenuBarIcon.image(working: working, waiting: waiting)
            let scale = 8, size = 18 * scale
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return 1 }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            NSColor(white: 0.12, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: size, height: size).fill()
            let tinted = NSImage(size: icon.size, flipped: false) { rect in icon.draw(in: rect); NSColor.white.setFill(); rect.fill(using: .sourceAtop); return true }
            tinted.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
            NSGraphicsContext.restoreGraphicsState()
            try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appending(path: "menueleiste-\(name).png"))
        }
        return 0
    }
}
