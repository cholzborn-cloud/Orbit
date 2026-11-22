import AppKit
import SwiftUI

// Takt der Dauer-Animationen (Schreibpunkte, Schimmer, Lade-Orbs): höchstens 30 Bilder je Sekunde und Pause, solange Orbit nicht
// die aktive App ist (wie die Figuren im FigureTicker). Selbsttests und Bildfolgen laufen ohne aktive App und pausieren daher nie.
@MainActor @Observable
final class AppActivity {
    static let shared = AppActivity()
    private(set) var isActive: Bool

    private init() {
        isActive = NSApp?.isActive ?? true
        for (name, active) in [(NSApplication.didBecomeActiveNotification, true), (NSApplication.didResignActiveNotification, false)] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { AppActivity.shared.isActive = active }
            }
        }
    }

    var animates: Bool { isActive || NSApp?.activationPolicy() != .regular }
}

extension TimelineSchedule where Self == AnimationTimelineSchedule {
    @MainActor static func ambient(paused: Bool = false) -> AnimationTimelineSchedule {
        .animation(minimumInterval: 1.0 / 30, paused: paused || !AppActivity.shared.animates)
    }
}
