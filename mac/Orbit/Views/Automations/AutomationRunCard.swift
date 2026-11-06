import SwiftUI

// Figma: nur der Laufstand; das Ergebnis folgt als normale Antwort.
struct AutomationRunCard: View {
    let name: String
    var prompt = ""
    var run: AutomationMessage?
    var retry: (() -> Void)?
    var retrying = false

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if run?.active == true || retrying {
                Spinner(size: Theme.Metrics.pt14).foregroundStyle(Theme.Palette.linkNeutral)
            } else {
                Image(systemName: run?.failed == true ? "exclamationmark.circle" : "checkmark")
                    .foregroundStyle(run?.failed == true ? Theme.Palette.destructive : Theme.Palette.linkNeutral)
            }
            Text(retrying ? "\(name) wird erneut gestartet …" : (run?.label ?? name))
            if run?.failed == true, !retrying, let retry {
                Button(action: retry) { Text("Erneut versuchen").underline() }
                    .font(Theme.Fonts.geist(Theme.Fonts.size13, .medium))
                    .buttonStyle(.plain).foregroundStyle(Theme.Palette.foreground)
            }
        }
        // Figma Automation-Lauf (143:52141): Zeile 26 (innen 4/0), 13/18.
        .font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt18))
        .padding(.vertical, Theme.Metrics.pt4)
        .foregroundStyle(run?.failed == true && !retrying ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
        .accessibilityElement(children: .contain)
        .probe("automation-run-card")
    }
}
