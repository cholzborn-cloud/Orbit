import SwiftUI

// Schreib-Punkte wie TypingBubble im Web (app/globals.css typing-dot): drei Punkte 4 pt, Abstand 3, je 1,2 s ease-in-out,
// Versatz 160 ms; bei 30 % 3 pt hoch und voll sichtbar, sonst Deckkraft 0,35. „Bewegung reduzieren“: still bei 0,6.
struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionClock) private var clock

    var body: some View {
        TimelineView(.ambient(paused: reduceMotion || clock != nil)) { context in
            let t = clock ?? context.date.timeIntervalSinceReferenceDate
            HStack(spacing: Theme.Metrics.pt3) {
                ForEach(0..<3, id: \.self) { i in
                    let v = Theme.Motion.dot(Theme.Motion.typingDot, at: t, delay: Double(i) * 0.16)
                    Circle().frame(width: Theme.Metrics.pt4, height: Theme.Metrics.pt4)
                        .opacity(reduceMotion ? 0.6 : v[1])
                        .offset(y: reduceMotion ? 0 : v[0])
                }
            }
            .frame(height: Theme.Metrics.pt16)
        }
        .accessibilityElement()
        .accessibilityLabel("Antwortet")
    }
}

// „arbeitet“ mit drei Punkten wie WorkingLabel im Web (orbi-dot): je 1,2 s ease-in-out, Versatz 0,2 s, Deckkraft 0,25 ↔ 1 (bei 40 %).
struct WorkingLabel: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionClock) private var clock

    var body: some View {
        TimelineView(.ambient(paused: reduceMotion || clock != nil)) { context in
            let t = clock ?? context.date.timeIntervalSinceReferenceDate
            HStack(spacing: Theme.Metrics.pt0) {
                Text("arbeitet")
                ForEach(0..<3, id: \.self) { i in
                    Text(".").opacity(reduceMotion ? 1 : Theme.Motion.dot(Theme.Motion.workingDot, at: t, delay: Double(i) * 0.2)[0])
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("arbeitet")
    }
}

extension EnvironmentValues {
    // Feste Uhr für Bildfolgen im Selbsttest (unsichtbare Fenster animieren nicht); nil = echte Zeit.
    @Entry var motionClock: Double?
}
