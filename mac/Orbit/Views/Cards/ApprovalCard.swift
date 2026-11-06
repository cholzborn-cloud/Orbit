import SwiftUI

// Freigabekarte: Werkzeug und Eingabe, Einmal / Immer / Ablehnen, Hinweis „Wartet bis zu 24 Stunden“ (Web: components/chat/approval-card.tsx, Figma S4 Karten Freigabe).
struct ApprovalCardView: View {
    let botName: String
    let tool: String
    let input: JSONValue?
    // Phase 1: deutscher Satz und Art aus dem Dienst (reason); fehlen sie, gilt der alte Titel.
    var text: String?
    var detail: String?
    var reason: String?
    var neutral = false
    var phase: ApprovalPhase
    var now: Date = .now
    var busy = false
    var error: String?
    var expandedInput = false
    var onDecide: (ServiceClient.ApprovalDecision) -> Void = { _ in }
    @State private var showInput = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            // Figma 04/teil-1: ein Satz, was der Orbi möchte (14), darunter die Knöpfe oder eine Zeile mit dem Ergebnis.
            Text(title)
                .font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Fonts.bodyLine))
                .foregroundStyle(Theme.Palette.cardForeground)
                .fixedSize(horizontal: false, vertical: true)
            if let label = previewLabel { Text(label).font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.cardForeground) }
            if let preview = previewDetail { detailBlock(preview) }
            footer
            // Abweichung von Figma (Sicherheit): Wer freigibt, kann die genauen Eingaben ansehen; klein und gedämpft.
            if case .open = phase, expandedInput, input != nil {
                Button { showInput.toggle() } label: { Text("Eingaben ansehen").font(Theme.Fonts.small).underline().foregroundStyle(Theme.Palette.mutedForeground) }
                    .buttonStyle(.plain).accessibilityValue(showInput || expandedInput ? "aufgeklappt" : "zugeklappt")
                if showInput || expandedInput { CodeBox(text: input?.prettyRedacted() ?? "–", background: Theme.Palette.muted) }
            }
        }
        .padding(Theme.Metrics.pt14)
        .cardSurface(radius: Theme.Metrics.pt12, line: Theme.Metrics.pt0_5)
        .webCardWidth(max: Theme.Metrics.pt360)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Freigabe")
    }

    private var previewLabel: String? {
        switch reason {
        case "nachricht": "Entwurf"
        case "geld": "Betrag"
        case "geheimnis": "Zugangsdaten"
        default: nil
        }
    }

    private var previewDetail: String? {
        if reason == "geheimnis" { return "Zugangsdaten werden nicht angezeigt. Prüfe, welchem Dienst du Zugriff erlaubst." }
        if let detail, !detail.isEmpty { return detail }
        if reason == "nachricht" || reason == "geld" { return "Details konnten nicht automatisch erkannt werden. Prüfe sie im verbundenen Dienst." }
        return nil
    }

    // Der Chat scrollt die Karte mit; Details bleiben vollständig lesbar.
    private func detailBlock(_ detail: String) -> some View {
        Text(detail)
            .font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Fonts.smallLine))
            .foregroundStyle(Theme.Palette.mutedForeground)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("Details: \(detail)")
    }

    private var title: String {
        if let text, !text.isEmpty { return text }
        return "\(botName) möchte eine Aktion ausführen."
    }

    @ViewBuilder private var footer: some View {
        switch phase {
        case .open:
            if let error { InlineAlert(text: error).font(Theme.Fonts.small) }
            // Passen die drei Knöpfe nicht nebeneinander (kleines Fenster), stehen sie untereinander statt abgeschnitten.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Spacing.sm) { buttons }
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) { buttons }
            }
            .disabled(busy)
        case .expired:
            closed("Abgelaufen", symbol: "clock.arrow.circlepath")
        case .decided(let approved, let always):
            // Figma 04/teil-1: „Einmal erlaubt“, „Immer erlaubt“, „Abgelehnt“.
            closed(approved ? (always ? "Immer erlaubt" : "Einmal erlaubt") : "Abgelehnt", symbol: approved ? "checkmark" : "xmark")
        case .gone:
            closed("Nicht mehr offen", symbol: "questionmark.circle")
        }
    }

    @ViewBuilder private var buttons: some View {
        Button("Einmal erlauben") { onDecide(.once) }.buttonStyle(.pill(.solid, neutral: neutral))
        if ApprovalReason.allowsAlways(ApprovalReason.normalized(reason)) {
            Button("Immer erlauben") { onDecide(.always) }.buttonStyle(.pill(.tint, neutral: neutral))
        }
        Button("Ablehnen") { onDecide(.deny) }.buttonStyle(.pill(.bordered))
    }

    // Ergebniszeile: Symbol und Wort in gedämpfter Schrift (Figma: „Einmal erlaubt“, „Abgelehnt“, „Abgelaufen“).
    private func closed(_ title: String, symbol: String) -> some View {
        HStack(spacing: Theme.Metrics.pt6) {
            Image(systemName: symbol).font(.system(size: Theme.Metrics.pt14))   // Figma: Symbol 14
            Text(title).font(Theme.Fonts.geist(Theme.Metrics.pt13)).lineHeight(.exact(points: Theme.Metrics.pt18))   // Figma 145:58643: Zeile 18
        }
        .foregroundStyle(Theme.Palette.mutedForeground)
        .accessibilityElement(children: .combine)
    }
}
