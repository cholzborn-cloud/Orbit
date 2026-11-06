import AppKit
import SwiftUI

// Beispieldaten ohne Dienst für `--selftest-fokus` und `--screenshot-menus`: vier Orbis, ein Chat mit Antworten, keine Routinen.
@MainActor
enum MenuFixtures {
    static let size = CGSize(width: 1180, height: 780)

    static func model() -> AppModel {
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!,
                                   dataDirectory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: "orbit-menus-no-service"))
        let model = AppModel(client: client)
        let now = Date(timeIntervalSince1970: 1_793_626_320)
        let specs = [("Toni", "trixi", "pink"), ("Coding", "nova", "violett"), ("Research", "strobi", "indigo"), ("Planer", "citrus", "gruen")]
        let bots = specs.enumerated().map { index, spec in
            Bot(chatId: "ux-chat-\(index)", id: "ux-orbi-\(index)", name: spec.0, avatar: spec.1,
                color: Theme.OrbiColor.all.first { $0.name == spec.2 }?.lightHex, job: "Hilft dir im Alltag", instructions: nil,
                isMain: index == 0, look: nil, lastMessageAt: now.addingTimeInterval(-Double(index)), onboardingDone: true)
        }
        model.botStore.simulate(BotsResponse(main: bots[0], bots: Array(bots.dropFirst()), groups: []))
        model.automations.simulate(list: .loaded([]))
        model.panelOpen = false
        var metadata = ChatMetadata()
        metadata.createdAt = now.timeIntervalSince1970 * 1000
        model.chatStore.session(for: bots[1].chatId).simulate(messages: [
            ChatMessage(id: "ux-1", role: .assistant, parts: [.text("Die Screenshots liegen auf dem Mac, den Ordner hab ich geöffnet.")]),
            ChatMessage(id: "ux-2", role: .user, parts: [.text("Danke, schau ich mir an.")], metadata: metadata),
            ChatMessage(id: "ux-3", role: .assistant, parts: [.text("Gern. Sag Bescheid, wenn dir etwas auffällt.")])
        ])
        model.selection = .bot(bots[1].id)
        return model
    }

    // Rahmen der `.probe`-Elemente im Fensterraum (oben links).
    final class Frames { var frames: [String: CGRect] = [:] }

    static func window(_ model: AppModel, frames: Frames, appearance: NSAppearance.Name = .darkAqua, staticRendering: Bool = false) -> NSWindow {
        let root = MainWindow(model: model)
            .environment(\.staticRendering, staticRendering).environment(\.titleBarInset, 0)
            .environment(\.layoutProbing, true)
            .environment(\.figuresStatic, true)
            .frame(width: size.width, height: size.height)
            .onPreferenceChange(LayoutFrames.self) { frames.frames = $0 }
        // Mit Titelleiste, damit das Fenster Hauptfenster wird und Tastaturfokus hat (randlose Fenster werden nie key).
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        window.contentView = NSHostingView(rootView: AnyView(root))
        window.alphaValue = 0
        return window
    }

    // Klick wie mit der Maus an einen Punkt im Fensterraum (oben links).
    static func click(_ window: NSWindow, at point: CGPoint) async {
        // Echte Klicks treffen ein aktives Fenster; holt sich ein anderes Programm den Vordergrund, erst zurückholen.
        if !window.isKeyWindow {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
        }
        let height = window.contentView?.bounds.height ?? size.height
        let location = NSPoint(x: point.x, y: height - point.y)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            if let event = NSEvent.mouseEvent(with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                              windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) {
                // Über die Ereigniswarteschlange wie echte Mausklicks: so sehen auch lokale Ereignismonitore den Klick.
                NSApp.postEvent(event, atStart: false)
            }
            try? await Task.sleep(for: .milliseconds(60))
        }
        try? await Task.sleep(for: .milliseconds(300))
    }
}
