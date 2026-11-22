// Wird nur im isolierten Einstellungen-Selbsttest in die App-Kopie eingefügt.
struct SceneProbeHiddenWindow: NSViewRepresentable {
    final class View: NSView {
        override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); window?.alphaValue = 0 }
    }
    func makeNSView(context: Context) -> View { View() }
    func updateNSView(_ view: View, context: Context) {}
}
struct SceneProbeDriver: View {
    let store: SettingsStore
    @Environment(\.openSettings) private var openSettings
    var body: some View {
        Color.clear.frame(width: 1, height: 1).background(SceneProbeHiddenWindow()).task {
            openSettings()
            try? await Task.sleep(for: .seconds(2))
            guard NSApp.windows.allSatisfy({ $0.alphaValue == 0 }) else { print("FAIL sichtbares Testfenster"); exit(1) }
            guard let window = NSApp.windows.first(where: { Int($0.frame.width) == 768 && $0.styleMask.contains(.titled) }),
                  window.alphaValue == 0, Int(window.frame.height) == 532,
                  Int(window.contentLayoutRect.height) == 500 else {
                for w in NSApp.windows { print("WINDOW alpha=\(w.alphaValue) frame=\(w.frame) content=\(w.contentLayoutRect)") }
                print("FAIL settings scene")
                exit(1)
            }
            guard window.title == "Einstellungen" else { print("FAIL settings title: \(window.title)"); exit(1) }
            print("SCENE title=\(window.title) frame=\(Int(window.frame.width))x\(Int(window.frame.height)) content=\(Int(window.contentLayoutRect.width))x\(Int(window.contentLayoutRect.height)) titlebar=\(Int(window.frame.height - window.contentLayoutRect.height)) alpha=\(window.alphaValue) style=\(window.styleMask.rawValue)")
            store.section = .usage
            for (index, section) in SettingsSection.allCases.enumerated() {
                let point = NSPoint(x: 60, y: 500 - 28 - CGFloat(index) * 34)
                for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                    guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else { exit(1) }
                    window.sendEvent(event)
                }
                try? await Task.sleep(for: .milliseconds(100))
                guard store.section == section else { print("FAIL click \(section.title)"); exit(1) }
                print("CLICK \(section.title) OK")
            }
            for hasToolbar in [false, true] {
                window.toolbar = hasToolbar ? NSToolbar(identifier: "SceneProbeToolbar") : nil
                for (name, style) in [("automatic", NSWindow.ToolbarStyle.automatic), ("unified", .unified), ("compact", .unifiedCompact), ("preference", .preference), ("expanded", .expanded)] {
                    window.toolbarStyle = style
                    try? await Task.sleep(for: .milliseconds(150))
                    let chrome = window.frame.height - window.contentLayoutRect.height
                    let close = window.standardWindowButton(.closeButton)
                    print("STYLE toolbar=\(hasToolbar) name=\(name) chrome=\(chrome) close=\(close != nil) movable=\(window.isMovable) title=\(window.title)")
                }
            }
            exit(0)
        }
    }
}
struct SettingsSceneProbeApp: App {
    @State private var store = SettingsStore(client: ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, tokenOverride: { "" }))
    var body: some Scene {
        Window("Probe", id: "probe") { SceneProbeDriver(store: store) }
        // SETTINGS_SCENE
    }
}
