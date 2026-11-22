import AppKit
import SwiftUI

// `Orbit --screenshot <Ordner>`: rendert das Hauptfenster hell und dunkel als PNG, unsichtbar und ohne Dock-Symbol.
@MainActor
enum ScreenshotMode {
    private static let prompt = "Erkläre kurz drei Planeten. Nutze eine Liste mit Spiegelstrichen, einen kleinen Python-Codeblock mit einer Planeten-Liste und danach eine lange Geschichte (mindestens 800 Wörter) über einen Planeten. Keine Überschriften."

    // chat: sendet eine echte Frage (nur gegen eine Datenbankkopie!) und rendert mitten im Streaming.
    static func run(directory: String, chat: Bool, figures: Bool = false) async -> Int32 {
        let model = AppModel()
        defer { model.shutdown() }
        await model.start()
        guard let orbi = model.botStore.orbis.first else { return 1 }
        model.selection = .bot(orbi.id)
        let session = model.chatStore.session(for: orbi.chatId)
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            if figures {
                // Chat mit Figuren in Seitenleiste, Kopf und Antwortblase. Der Verlauf wird nur gelesen; die Zustände kommen als
                // Ereignisse im Format von GET /v1/events (wie vom Dienst), die Figuren sind statisch gezeichnet.
                await session.load()
                await session.waitUntilIdle()
                try await Task.sleep(for: .seconds(1.5))
                for (name, status) in [("arbeitet", "arbeitet"), ("wartet", "wartet")] {
                    model.events.apply(Data("{\"type\":\"status\",\"chatId\":\"\(orbi.chatId)\",\"botId\":\"\(orbi.id)\",\"status\":\"\(status)\"}".utf8))
                    try await capture(model, directory: directory, prefix: "mac4a1-chat-\(name)", staticFigures: true)
                }
            } else if chat {
                await session.load()
                await session.waitUntilIdle()
                session.model = ProcessInfo.processInfo.environment["ORBIT_TEST_MODEL"] ?? "claude-sonnet-5-5"
                session.effort = "low"
                let known = Set(session.messages.map(\.id))
                session.send(prompt)
                // 1. Orb: gleich nach dem Senden, bevor der erste Text da ist.
                try await Task.sleep(for: .milliseconds(150))
                try await capture(model, directory: directory, prefix: "mac3b-orb", settle: 0.35)
                // 2. Streaming: nach etwas Text einfrieren, damit beide Bilder denselben Stand zeigen.
                let deadline = Date().addingTimeInterval(90)
                while Date() < deadline, session.isRunning, (session.messages.last { $0.role == .assistant && !known.contains($0.id) }?.text.count ?? 0) < 700 {
                    try await Task.sleep(for: .milliseconds(20))
                }
                session.detach(freeze: true)
                try await capture(model, directory: directory, prefix: "mac3b-chat")
                try await session.stopRemote()
            } else {
                try await capture(model, directory: directory, prefix: "mac3a-sidebar")
            }
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    // Rendert das Hauptfenster hell und dunkel unsichtbar (alpha 0, kein Dock-Symbol).
    static func capture(_ model: AppModel, directory: String, prefix: String, settle: Double = 1.2, staticFigures: Bool = false, size: CGSize = CGSize(width: 1100, height: 720)) async throws {
        var windows: [(String, NSWindow, NSHostingView<AnyView>)] = []
        for (name, appearance) in [("dark", NSAppearance.Name.darkAqua), ("light", .aqua)] {
            let window = NSWindow(
                contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
                backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: appearance)
            let host = NSHostingView(rootView: AnyView(MainWindow(model: model).environment(\.figuresStatic, staticFigures).environment(\.titleBarInset, 0)))
            window.contentView = host
            window.alphaValue = 0
            window.orderFrontRegardless()
            windows.append((name, window, host))
        }
        try await Task.sleep(for: .seconds(settle))
        for (name, window, host) in windows {
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds),
                  host.bounds.width > 0
            else { throw ServiceError.invalidResponse }
            host.cacheDisplay(in: host.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else { throw ServiceError.invalidResponse }
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "\(prefix)-\(name).png"))
            window.orderOut(nil)
        }
    }
}

final class ScreenshotDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    private let chat: Bool
    private let figures: Bool
    init(directory: String, chat: Bool, figures: Bool = false) {
        self.directory = directory
        self.chat = chat
        self.figures = figures
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory, chat = chat, figures = figures
        Task { @MainActor in exit(await ScreenshotMode.run(directory: directory, chat: chat, figures: figures)) }
    }
}
