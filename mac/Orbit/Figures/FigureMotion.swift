import AppKit

// Globaler Zeigerstand (Bildschirmkoordinaten): `NSEvent.mouseLocation` braucht keine Berechtigung, auch außerhalb des Fensters.
@MainActor
final class PointerTracker {
    static let shared = PointerTracker()
    private(set) var location = CGPoint(x: -9999, y: -9999)
    private(set) var lastMoved: TimeInterval = -1e9
    // Nur für Tests: feste Zeigerposition statt `NSEvent.mouseLocation`.
    var testPointer: CGPoint?
    func poll(now: TimeInterval) {
        let p = testPointer ?? NSEvent.mouseLocation
        if p != location { location = p; lastMoved = now }
    }
}

func systemReducesMotion() -> Bool {
    if ProcessInfo.processInfo.environment["ORBIT_REDUCE_MOTION"] == "1" { return true }
    return NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
}

