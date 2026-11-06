import SwiftUI

// Rahmen benannter Elemente im Fenster (für --selftest-layout). Nur aktiv, wenn `layoutProbing` gesetzt ist.
struct LayoutFrames: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { first, _ in first }
    }
}

private struct LayoutProbingKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var layoutProbing: Bool {
        get { self[LayoutProbingKey.self] }
        set { self[LayoutProbingKey.self] = newValue }
    }
}

// Höhe der Titelleiste, die der Inhalt freihält (versteckte Titelleiste: Ampelknöpfe stehen über der Seitenleiste). Im Test 0.
private struct TitleBarInsetKey: EnvironmentKey { static let defaultValue: CGFloat = 0 }
extension EnvironmentValues {
    var titleBarInset: CGFloat {
        get { self[TitleBarInsetKey.self] }
        set { self[TitleBarInsetKey.self] = newValue }
    }
}

extension View {
    func probe(_ name: String) -> some View { modifier(ProbeModifier(name: name)) }
}

private struct ProbeModifier: ViewModifier {
    let name: String
    @Environment(\.layoutProbing) private var probing

    func body(content: Content) -> some View {
        if probing {
            content.background(GeometryReader { geometry in
                Color.clear.preference(key: LayoutFrames.self, value: [name: geometry.frame(in: .named("orbit-window"))])
            })
        } else {
            content
        }
    }
}
