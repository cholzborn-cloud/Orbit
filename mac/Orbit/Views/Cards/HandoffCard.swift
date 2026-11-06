import SwiftUI

// Übergabe (nur gespeicherte alte Verläufe, Werkzeug `handoff`) als Zeile nach Figma 02/teil-11 „Übergabe-Zeilen“ (7.1: Regular 12, Lücke 8):
// kleine Figur des Ziels und ein Satz, der den Stand nennt („Nachricht gesendet an Nova“ schimmert, „Nova ist fertig“, Fehler rot).
// Ein Klick klappt Aufgabe und Inhalt auf; eine wartende Freigabe steht gleich offen. Kein Kasten, kein Chevron.
struct HandoffCardView<Content: View>: View {
    let info: HandoffInfo
    let phase: HandoffPhase
    // Wer übergibt und ob er parallel weiterschreibt (nur noch für die Beschriftung).
    var by: String?
    var writing = false
    var opened = false
    var onStop: (() -> Void)?
    @ViewBuilder var content: () -> Content
    @State private var open = false

    private var expanded: Bool { open || opened || phase.waitingForApproval }

    private var active: Bool { phase.kind == .running || phase.kind == .waiting }

    var body: some View {
        VStack(alignment: .center, spacing: Theme.Spacing.sm) {
            HStack(spacing: Theme.Spacing.sm) {
                OrbiAvatar(name: phase.target, avatar: info.avatar, colorHex: info.color, state: phase.kind == .running ? .working : .calm,
                           size: Theme.Metrics.pt16, live: false, follow: false)
                    .frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16)
                sentence
                if active, let onStop {
                    Button("Stoppen", action: onStop).buttonStyle(.pill(.outline)).help("Bricht diese Übergabe und alle Unteraufträge ab")
                }
            }
            .font(Theme.Fonts.small).lineLimit(1)
            .contentShape(.rect)
            .onTapGesture { open.toggle() }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(expanded ? "aufgeklappt" : "zugeklappt")
            if expanded {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Text("Aufgabe: \(info.task)").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
                    content()
                }
                .frame(maxWidth: Theme.Metrics.pt560, alignment: .leading)
            }
        }
        // Consti 06.11.: Übergabe-Zeile mittig im Chat.
        .frame(maxWidth: .infinity, alignment: .center)
    }

    @ViewBuilder private var sentence: some View {
        switch phase.kind {
        case .running:
            ShimmerText(text: phase.waitingForApproval ? "\(phase.target) wartet auf deine Freigabe" : "Nachricht gesendet an \(phase.target)")
        // Consti 06.11.: kein „ist fertig“ mehr, nur „Nachricht gesendet an …“.
        case .waiting, .finished:
            Text("Nachricht gesendet an \(phase.target)").foregroundStyle(Theme.Palette.mutedForeground)
        case .failed:
            Text("\(phase.target) konnte die Nachricht nicht annehmen").foregroundStyle(Theme.Palette.destructive)
        }
    }
}

// Text mit Schimmer: alle paar Sekunden läuft ein Lichtband (Standard von links nach rechts) darüber, damit man sieht, dass noch gearbeitet wird.
// Mit „Bewegung reduzieren“ und im Standbild steht der Text still.
struct ShimmerText: View {
    let text: String
    var period: TimeInterval = Theme.Motion.shimmerPeriod
    var sweep: TimeInterval = Theme.Motion.shimmerSweep
    // Live-Zeile (Figma 26:10581): von rechts nach links; Übergabe-Zeile: links nach rechts.
    var reverse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        if reduceMotion || staticRendering {
            Text(text).foregroundStyle(Theme.Palette.mutedForeground)
        } else {
            TimelineView(.ambient()) { context in
                let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / sweep
                Text(text).foregroundStyle(Theme.Palette.mutedForeground)
                    .overlay(alignment: .leading) {
                        Text(text).foregroundStyle(Theme.Palette.foreground)
                            .mask(alignment: .leading) {
                                GeometryReader { box in
                                    let band = max(Theme.Metrics.pt40, box.size.width * 0.35)
                                    LinearGradient(colors: [.clear, Theme.Palette.maskOpaque, .clear], startPoint: .leading, endPoint: .trailing)
                                        .frame(width: band)
                                        .offset(x: reverse ? box.size.width - min(max(t, 0), 1.2) * (box.size.width + band) : -band + min(max(t, 0), 1.2) * (box.size.width + band))
                                        .opacity(t <= 1.2 ? 1 : 0)
                                }
                            }
                    }
                    .lineLimit(1)
            }
        }
    }
}
