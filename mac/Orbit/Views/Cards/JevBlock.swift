import SwiftUI

// Jev-Block unter einer Antwort: aufklappbar mit Begründung, Stufe, Modell, Sicherheit, Dauer, Quelle (Web: components/jev/jev-block.tsx).
struct JevBlockView: View {
    let info: JevInfo
    var opened = false
    @State private var open = false

    private static let tiers = ["small": "Klein", "medium": "Mittel", "large": "Groß", "coding": "Programmieren"]
    private static let efforts = ["low": "Low", "medium": "Mid", "high": "High", "xhigh": "XHigh", "max": "Max"]

    private var headline: String {
        info.source == "fallback"
            ? "Standardmodell (Jev nicht erreichbar)"
            : "Jev: \(info.modelLabel ?? info.model ?? "Standardmodell") gewählt"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            Button { open.toggle() } label: {
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "sparkles").font(.system(size: Theme.Metrics.pt14)).frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16)
                    Text(headline).font(Theme.Fonts.geist(Theme.Metrics.pt12)).lineHeight(.exact(points: Theme.Metrics.pt16)).lineLimit(1).truncationMode(.tail)
                    Spacer(minLength: Theme.Metrics.pt0)
                    Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt12)).rotationEffect(.degrees(open || opened ? 180 : 0))
                }
                .foregroundStyle(Theme.Palette.mutedForeground)
                .padding(.horizontal, Theme.Metrics.pt10)
                .frame(minHeight: Theme.Metrics.pt32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(open || opened ? "aufgeklappt" : "zugeklappt")
            if open || opened {
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt1)
                Grid(alignment: .topLeading, horizontalSpacing: Theme.Spacing.md, verticalSpacing: Theme.Metrics.pt4) {
                    row("Begründung", info.reason.isEmpty ? "–" : info.reason)
                    row("Stufe", info.tier.flatMap { Self.tiers[$0] } ?? "–")
                    row("Modell + Effort", (info.modelLabel ?? info.model ?? "–") + (info.effort.map { " · \(Self.efforts[$0] ?? $0)" } ?? ""))
                    row("Sicherheit", info.confidence.map { "\(Int(($0 * 100).rounded())) %" } ?? "–")
                    row("Dauer", "\(Int(info.durationMs)) ms")
                    row("Quelle", info.source == "jev" ? "Jev" : "Fallback: Standardmodell")
                }
                .padding(.horizontal, Theme.Metrics.pt10).padding(.vertical, Theme.Spacing.sm)
            }
        }
        .font(Theme.Fonts.geist(Theme.Metrics.pt12))
        .cardSurface(fill: Theme.Palette.muted.opacity(0.4))
        .webCardWidth(max: Theme.Metrics.pt576)
    }

    private func row(_ label: String, _ value: String) -> some View {
        GridRow {
            Text(label).foregroundStyle(Theme.Palette.mutedForeground)
            Text(value).foregroundStyle(Theme.Palette.foreground).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
        }
    }
}
