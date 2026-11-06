import Observation
import SwiftUI

// Fragebogen über dem Eingabefeld: Zeilen mit Nummer (Taste 1–4), „Empfohlen“, eigenes Feld, Überspringen.
struct AskPanelView: View {
    @Bindable var model: AskPanelModel
    var onSubmit: ([QuestionAnswer]) -> Void = { _ in }
    var onSkip: () -> Void = {}
    // In Gruppen neutral (Figma 139:39841): Nummer/Haken foreground auf background, „Weiter“ neutral.
    var neutral = false
    @FocusState private var fieldFocused: Bool
    @FocusState private var panelFocused: Bool
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        if let question = model.question {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                header(question)
                options(question)
                footer(question)
            }
            .cardSurface(radius: Theme.Metrics.pt12, line: Theme.Metrics.pt0_5)
            // Alle Fragen gleich breit, unabhängig vom Inhalt.
            .frame(idealWidth: Theme.Metrics.pt520, maxWidth: .infinity)
            .webCardWidth(max: Theme.Metrics.pt520)
            .focusable()
            .focused($panelFocused)
            .focusEffectDisabled()
            .onKeyPress(characters: .decimalDigits) { press in
                // Zifferntasten wählen, solange nicht ins eigene Feld getippt wird.
                guard !fieldFocused, let number = Int(press.characters) else { return .ignored }
                if let answers = model.select(number: number) { onSubmit(answers) }
                return .handled
            }
            .onAppear { panelFocused = true }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Frage")
        }
    }

    private func header(_ question: AskQuestion) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                Text(question.question).font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt22)).foregroundStyle(Theme.Palette.cardForeground)   // Figma 139:39743: 14/22
                    .fixedSize(horizontal: false, vertical: true)
                Text(question.multiple ? "Mehrere Antworten möglich" : "Eine Antwort auswählen").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
            }
            Spacer(minLength: Theme.Metrics.pt0)
            if model.questions.count > 1 {
                HStack(spacing: Theme.Metrics.pt4) {
                    // Figma Blättern (139:39746): Knöpfe 24 × 24; der Lucide-Pfeil im 14er-Feld ist 5 × 8 groß, das entspricht SF-Symbol 10.
                    Button { model.previous() } label: { Image(systemName: "chevron.left").font(.system(size: Theme.Metrics.pt10)).frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24) }
                        .disabled(model.page == 0).accessibilityLabel("Vorherige Frage")
                    Text("\(model.page + 1) von \(model.questions.count)").font(Theme.Fonts.small.monospacedDigit())
                    Button { model.nextPage() } label: { Image(systemName: "chevron.right").font(.system(size: Theme.Metrics.pt10)).frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24) }
                        .disabled(model.isLast).accessibilityLabel("Nächste Frage")
                }
                .buttonStyle(.plain).foregroundStyle(Theme.Palette.mutedForeground)
            }
        }
        .padding(.horizontal, Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt16).padding(.bottom, Theme.Spacing.sm)
    }

    private func options(_ question: AskQuestion) -> some View {
        VStack(spacing: Theme.Metrics.pt0) {
            ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                let on = model.isPicked(option.label)
                Button { if let answers = model.select(option.label) { onSubmit(answers) } } label: {
                    HStack(spacing: Theme.Spacing.md) {
                        marker(multiple: question.multiple, on: on, number: index + 1)
                        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                            HStack(spacing: Theme.Spacing.sm) {
                                Text(option.label).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt22)).foregroundStyle(Theme.Palette.cardForeground)
                                if option.recommended {
                                    // Figma: „Empfohlen“ als neutrale Pille (nicht in der Farbe des Orbis).
                                    Text("Empfohlen").font(Theme.Fonts.geist(Theme.Metrics.pt11, .medium)).foregroundStyle(Theme.Palette.foreground)
                                        .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt2)
                                        .background(Theme.Palette.secondaryRaised, in: .capsule)
                                }
                            }
                            if let description = option.description {
                                Text(description).font(Theme.Fonts.geist(Theme.Metrics.pt12)).foregroundStyle(Theme.Palette.mutedForeground)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: Theme.Metrics.pt0)
                    }
                    .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt10)
                    .contentShape(.rect(cornerRadius: Theme.Radius.md))
                }
                .buttonStyle(AskRowStyle())
                .probe("ask-row-\(index)")
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityLabel("\(index + 1). \(option.label)\(option.recommended ? ", empfohlen" : "")")
            }
        }
        .padding(.horizontal, Theme.Metrics.pt8).padding(.bottom, Theme.Metrics.pt4)
    }

    // Figma: Nummern- und Haken-Felder 22 x 22, Radius 6, Fläche secondary; gewählt in der Farbe des Orbis.
    @ViewBuilder private func marker(multiple: Bool, on: Bool, number: Int) -> some View {
        if multiple {
            // Figma 139:39891: aus secondary mit Rand border 0,5.
            RoundedRectangle(cornerRadius: Theme.Metrics.pt6)
                .fill(on ? accent : Theme.Palette.secondaryRaised)
                .overlay { if !on { RoundedRectangle(cornerRadius: Theme.Metrics.pt6).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) } }
                .overlay { if on { Image(systemName: "checkmark").font(.system(size: Theme.Metrics.pt11, weight: .bold)).foregroundStyle(accentForeground) } }
                .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
        } else {
            Text("\(number)").font(Theme.Fonts.smallMedium)   // Figma 139:39756: 12 Medium
                .foregroundStyle(on ? accentForeground : Theme.Palette.cardForeground)
                .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
                .background(on ? accent : Theme.Palette.secondaryRaised, in: .rect(cornerRadius: Theme.Metrics.pt6))
        }
    }

    private func footer(_ question: AskQuestion) -> some View {
        VStack(spacing: Theme.Metrics.pt0) {
            Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)
            if let error = model.error { InlineAlert(text: error).font(Theme.Fonts.geist(Theme.Metrics.pt12)).padding(.horizontal, Theme.Metrics.pt14).padding(.top, Theme.Spacing.sm) }
            HStack(spacing: Theme.Spacing.sm) {
                if !question.allowsCustom {
                    Spacer(minLength: Theme.Metrics.pt0)
                } else if staticRendering {
                    Text(model.custom.isEmpty ? "Etwas anderes …" : model.custom).font(Theme.Fonts.geist(Theme.Metrics.pt14))
                        .foregroundStyle(model.custom.isEmpty ? Theme.Palette.mutedForeground : Theme.Palette.cardForeground)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField("Etwas anderes …", text: $model.custom, prompt: Text("Etwas anderes …").foregroundStyle(Theme.Palette.mutedForeground))
                        .textFieldStyle(.plain).font(Theme.Fonts.geist(Theme.Metrics.pt14))
                        .focused($fieldFocused)
                        .onChange(of: model.custom) { model.customChanged() }
                        .onSubmit { if !model.choice.isEmpty { submit() } }
                        .accessibilityLabel("Eigene Antwort").probe("ask-field")
                }
                Button("Überspringen", action: onSkip)
                    .buttonStyle(.pill(.bordered)).disabled(model.sending).probe("ask-skip")
                    .accessibilityLabel("Frage überspringen")
                if question.multiple || (question.allowsCustom && !model.custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                    Button(action: submit) { Text(model.sending ? "Sendet …" : (question.multiple ? sendTitle : "Übernehmen")) }
                        .buttonStyle(.pill(.solid, neutral: neutral))
                        .disabled(model.sending).probe("ask-submit")
                }
            }
            .padding(.horizontal, Theme.Metrics.pt16).padding(.vertical, Theme.Metrics.pt10)
        }
    }

    private var accent: Color { neutral ? Theme.Palette.foreground : Theme.Palette.primary }
    private var accentForeground: Color { neutral ? Theme.Palette.background : Theme.Palette.primaryForeground }

    // Ohne Wahl bleibt „Senden“ (oder „Weiter“); der Knopf überspringt dann nur diese Frage.
    private var sendTitle: String {
        model.choice.isEmpty ? (model.isLast ? "Senden" : "Weiter") : model.buttonTitle
    }

    private func submit() {
        // Ohne Wahl wird die Frage übersprungen (leere Antwort); die Antworten der anderen Seiten bleiben erhalten.
        if let answers = model.advance() { onSubmit(answers) }
        else { fieldFocused = false; panelFocused = true }
    }
}

private struct AskRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? Theme.Palette.muted.opacity(0.4) : .clear, in: .rect(cornerRadius: Theme.Radius.md))
    }
}

// Beantwortete Fragen bleiben als kleine Karte im Verlauf (Figma 04/teil-2, „Zusammenfassung“): Frage gedämpft (12), Antwort darunter (14, Medium).
struct AskSummaryView: View {
    let result: AskResult

    var body: some View {
        // Figma Zusammenfassung (139:39909): 448 breit, innen 12/16, r12; Frage 12/18, Antwort 14 Medium/22, je Eintrag innen 2.
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            ForEach(Array(result.answers.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    Text(item.question).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt18)).foregroundStyle(Theme.Palette.mutedForeground)
                    Text(result.skipped || item.answers.isEmpty ? "Übersprungen" : item.answers.joined(separator: ", "))
                        .font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt22)).foregroundStyle(Theme.Palette.cardForeground)
                }
                .padding(.vertical, Theme.Metrics.pt2)
            }
        }
        .padding(.horizontal, Theme.Metrics.pt16).padding(.vertical, Theme.Metrics.pt12)
        .cardSurface(radius: Theme.Metrics.pt12, line: Theme.Metrics.pt0_5)
        .webCardWidth(max: Theme.Metrics.pt448)
        .accessibilityElement(children: .combine)
    }
}
