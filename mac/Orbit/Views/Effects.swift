import SwiftUI

// Bewegte Effekte der Modellwahl nach app/globals.css: Gold der höchsten Stufe (effort-gold, effort-glow), Jev-Puls (jev-pulse)
// und Lichtlauf (jev-sweep). Alles steht still bei „Bewegung reduzieren“.

// Wandernde Lichtkante: Hintergrund 250 % breit, Position 120 % → −120 % in 3,2 s ease-in-out, endlos.
struct GoldGradient: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.ambient(paused: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Theme.Gold.period) / Theme.Gold.period
            // CSS-Kurve ease-in-out (cubic-bezier .42,0,.58,1) näherungsweise als smoothstep.
            let eased = t * t * (3 - 2 * t)
            let position = reduceMotion ? 0 : 1.2 - 2.4 * eased
            // background-position p % bei Hintergrundbreite 250 %: Versatz = (1 − 2,5) · p der Breite.
            let offset = -1.5 * position
            LinearGradient(stops: Theme.Gold.stops, startPoint: UnitPoint(x: offset, y: Theme.Metrics.pt0_5), endPoint: UnitPoint(x: offset + 2.5, y: Theme.Metrics.pt0_5))
        }
    }
}

extension View {
    // Text im Gold (Web: effort-gold effort-gold-text); aus = unverändert.
    @ViewBuilder func goldText(_ on: Bool) -> some View {
        if on { hidden().overlay { GoldGradient().mask { self } } } else { self }
    }

    // Sparkles/Jev-Puls: Deckkraft 1 ↔ 0,65 und Größe 1 ↔ 0,88, 2,4 s ease-in-out.
    func jevPulse() -> some View { modifier(JevPulse()) }

    // Jev-Kasten: Innenrand in der Akzentfarbe (22 %) und ein Lichtband, das alle 5 s durchläuft (60 % der Zeit unterwegs).
    func jevSweep(_ on: Bool, radius: CGFloat = Theme.Radius.lg) -> some View { modifier(JevSweep(on: on, radius: radius)) }
}

private struct JevPulse: ViewModifier {
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.opacity(dim ? 0.65 : 1).scaleEffect(dim ? 0.88 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: Theme.Motion.jevPulseDuration).repeatForever(autoreverses: true)) { dim = true }
            }
    }
}

private struct JevSweep: ViewModifier {
    let on: Bool
    let radius: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if on {
            content
                .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(Theme.Palette.primary.opacity(0.22), lineWidth: Theme.Metrics.pt1))
                .overlay {
                    GeometryReader { box in
                        TimelineView(.ambient(paused: reduceMotion)) { context in
                            let cycle = Theme.Motion.sweepPeriod
                            let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
                            // 0 → 60 %: von −120 % nach 120 %, danach Pause (Keyframes 0 %, 60 %, 100 %).
                            let progress = reduceMotion ? 0 : min(1, t / 0.6)
                            let eased = progress * progress * (3 - 2 * progress)
                            LinearGradient(colors: [.clear, Theme.Palette.primary.opacity(0.16), .clear], startPoint: UnitPoint(x: 0.3, y: 0.4), endPoint: UnitPoint(x: 0.7, y: 0.6))
                                .offset(x: box.size.width * (-1.2 + 2.4 * eased))
                                .opacity(reduceMotion ? 0 : 1)
                        }
                    }
                    .clipShape(.rect(cornerRadius: radius)).allowsHitTesting(false)
                }
        } else { content }
    }
}
