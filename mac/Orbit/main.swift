import AppKit
import Foundation

// Selbsttest und Screenshot laufen ohne NSApplication-Fenster; nur der normale Start öffnet die App.
let arguments = CommandLine.arguments
Theme.registerFonts()
if arguments.contains("--selftest-animationen") {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    Task { @MainActor in exit(SelfTestFigures.animationDiagnostics()) }
    dispatchMain()
} else if let index = arguments.firstIndex(of: "--endphase-render"), arguments.indices.contains(index + 1) {
    Task { @MainActor in exit(await EndphaseSnapshots.run(directory: arguments[index + 1], windowless: true)) }
    dispatchMain()
} else if let index = arguments.firstIndex(of: "--endphase-snapshots"), arguments.indices.contains(index + 1) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = EndphaseSnapshotsDelegate(directory: arguments[index + 1])
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-chat") {
    Task { @MainActor in exit(await SelfTestChat.run(arguments: arguments)) }
    dispatchMain()
} else if let index = arguments.firstIndex(of: "--screenshot-orbis"), arguments.indices.contains(index + 2) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotOrbisDelegate(directory: arguments[index + 1], scenario: arguments[index + 2])
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-ux"), arguments.indices.contains(index + 1) {
    // Neue Einstellungen und Chat mit Beispieldaten, ohne Dienst (ScreenshotUX).
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotUXDelegate(directory: arguments[index + 1])
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-menus"), arguments.indices.contains(index + 1) {
    // Jedes Menü offen, dunkel und hell, mit Beispieldaten ohne Dienst (ScreenshotMenus).
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotMenusDelegate(directory: arguments[index + 1])
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-composer"), arguments.indices.contains(index + 2) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotComposerDelegate(directory: arguments[index + 1], scene: arguments[index + 2])
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-cards"), arguments.indices.contains(index + 1) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotCardsDelegate(directory: arguments[index + 1])
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-karten"), arguments.indices.contains(index + 2) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotKartenDelegate(directory: arguments[index + 1], scenario: arguments[index + 2])
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-layout") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestLayoutDelegate(arguments: arguments)
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-karten") {
    // ImageRenderer braucht den echten Hauptthread mit Laufschleife; .accessory zeigt kein Dock-Symbol.
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestKartenDelegate(arguments: arguments)
    app.delegate = delegate
    app.run()
} else if arguments.contains("--bildfolgen") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = BildfolgenDelegate(arguments: arguments)
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-composer") {
    // Tastaturtest braucht ein echtes (unsichtbares) Fenster; .accessory zeigt kein Dock-Symbol.
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestComposerDelegate()
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--menueleiste-bild"), arguments.indices.contains(index + 1) {
    exit(MainActor.assumeIsolated { MenuBarSnapshot.run(directory: arguments[index + 1]) })
} else if arguments.contains("--dienst-einrichten") || arguments.contains("--dienst-entfernen") {
    Task { @MainActor in exit(await ServiceSetup.run(remove: arguments.contains("--dienst-entfernen"))) }
    dispatchMain()
} else if arguments.contains("--selftest-fragen-ui") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestAskDelegate()
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-leistung") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestLeistungDelegate()
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-scroll") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestScrollDelegate()
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-routinen") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestRoutinesDelegate()
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-4e"), arguments.indices.contains(index + 2) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotToolsDelegate(directory: arguments[index + 1], scene: arguments[index + 2])
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-desktop") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestDesktopDelegate()
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-fokus") {
    // Suchfeld-Fokus bei Klicks in die Seitenleiste, ohne Dienst (SelfTestFokus).
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestFokusDelegate()
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-suche") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestSearchDelegate()
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-einstellungen") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestSettingsDelegate()
    app.delegate = delegate
    app.run()
} else if let index = arguments.firstIndex(of: "--screenshot-einstellungen"), arguments.indices.contains(index + 2) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotSettingsDelegate(directory: arguments[index + 1], section: arguments[index + 2])
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest-orbis") {
    Task { @MainActor in exit(await SelfTestOrbis.run()) }
    dispatchMain()
} else if let index = arguments.firstIndex(of: "--app-icon"), arguments.indices.contains(index + 1) {
    Task { @MainActor in exit(AppIconRenderer.run(directory: arguments[index + 1])) }
    dispatchMain()
} else if arguments.contains("--selftest-figuren") {
    // ImageRenderer braucht den echten Hauptthread mit Laufschleife; .accessory zeigt kein Dock-Symbol.
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = SelfTestFiguresDelegate(arguments: arguments)
    app.delegate = delegate
    app.run()
} else if arguments.contains("--selftest") {
    Task { @MainActor in exit(await SelfTest.run()) }
    dispatchMain()
} else if let index = arguments.firstIndex(of: "--screenshot"), arguments.indices.contains(index + 1) {
    // AppKit braucht eine laufende Anwendung für Fenster; .accessory zeigt kein Dock-Symbol.
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = ScreenshotDelegate(directory: arguments[index + 1], chat: arguments.contains("--chat"), figures: arguments.contains("--figuren"))
    app.delegate = delegate
    app.run()
} else {
    OrbitApp.main()
}
