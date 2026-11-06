import SwiftUI

// Figma: eine Fehlerzeile ohne Fläche und technische Details.
struct ErrorCard: View {
    var title = "Antwort fehlgeschlagen."
    let message: String
    var retryLabel = "Erneut versuchen"
    var retrying = false
    var retry: (() -> Void)?
    var dismiss: (() -> Void)?

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if retrying {
                Spinner(size: Theme.Metrics.pt14).foregroundStyle(Theme.Palette.linkNeutral)
                Text("Versucht erneut …").foregroundStyle(Theme.Palette.mutedForeground)
            } else {
                // Figma Fehler (143:52183): Symbol 14, Abstand 8.
                HStack(spacing: Theme.Spacing.sm) {
                    Image(systemName: "exclamationmark.circle").font(.system(size: Theme.Metrics.pt14))
                    Text(title)
                }
                .foregroundStyle(Theme.Palette.destructive)
            }
            if !retrying, let retry {
                Button(action: retry) { Text(retryLabel).underline() }
                    .font(Theme.Fonts.geist(Theme.Fonts.size13, .medium)).buttonStyle(.plain).foregroundStyle(Theme.Palette.foreground)
            }
        }
        // Figma: Zeile 26 (innen 4/0), 13/18.
        .font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt18))
        .padding(.vertical, Theme.Metrics.pt4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(retrying ? "Versucht erneut" : "Fehler: \(ErrorText.translate(message).text)")
    }
}
