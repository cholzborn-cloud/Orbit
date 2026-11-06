import SwiftUI

// Erststart, Schritt vor dem Onboarding: „Alles bereit?“. Gleiche Bauteile wie Figma Onboarding 3 („Ein paar Zugriffe“): Figur, Titel,
// Untertitel, Karte mit Zeilen (Titel, Beschreibung, Knopf rechts), darunter „Weiter“. Die Zeilen sind die Prüfungen der Einrichtung;
// Schlüssel und Tagesbudget stehen unter Einstellungen → Einrichtung. „Weiter“ geht immer, Fehlendes lässt sich nachholen.
struct SetupIntroView: View {
    let model: AppModel
    @State private var editor = BotEditorModel(editing: nil, others: [])
    @Environment(\.openSettings) private var openSettings

    private var setup: SetupModel { model.settings.setup }

    init(model: AppModel) {
        self.model = model
        let editor = BotEditorModel(editing: nil, others: [])
        editor.useColor(hex: OrbiShape.strobi.baseHex)
        _editor = State(initialValue: editor)
    }

    var body: some View {
        // O14: gleiche Maße wie Onboarding 3: Figur 56, 16, Titel, 8, Text, 28, Karte, 28, Knöpfe 24 Regular 12.
        VStack(spacing: Theme.Metrics.pt0) {
            OrbiFigure(look: editor.look, state: .calm, live: true, follow: true, role: .editor)
                .frame(width: Theme.Metrics.pt56, height: Theme.Metrics.pt56)
                .padding(.bottom, Theme.Metrics.pt16)
            VStack(spacing: Theme.Spacing.sm) {
                Text("Alles bereit?").font(Theme.Fonts.largeTitle).foregroundStyle(Theme.Palette.foreground)
                Text("Kurz prüfen, ob Orbit alles hat, was es braucht.").font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
            }
            card.padding(.top, Theme.Metrics.pt28)
            HStack(spacing: Theme.Spacing.sm) {
                Button("Erneut prüfen") { Task { await setup.load() } }.buttonStyle(OnboardingStepButtonStyle(prominent: false)).disabled(setup.checks.isLoading)
                Button("Weiter") { model.finishSetupIntro() }.buttonStyle(OnboardingStepButtonStyle(prominent: true))
            }
            .padding(.top, Theme.Metrics.pt28)
            if setup.hasRequiredProblem {
                Text("Etwas Nötiges fehlt noch. Du kannst trotzdem weiter und es später in den Einstellungen nachholen.")
                    .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).multilineTextAlignment(.center)
                    .frame(maxWidth: Theme.Metrics.pt480).padding(.top, Theme.Spacing.md)
            }
        }
        .padding(Theme.Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.Palette.background)
        .foregroundStyle(Theme.Palette.foreground)
        .font(Theme.Fonts.body)
        .task { await model.loadSetupIntro() }
        .probe("setup-intro")
    }

    @ViewBuilder private var card: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            switch setup.checks {
            case .idle, .loading:
                row("Prüfung läuft …", detail: "Einen Moment.", action: nil, done: false)
            case .failed:
                row("Dienst nicht erreichbar", detail: "Orbit konnte den Hintergrunddienst nicht prüfen. Mit „Erneut prüfen“ versuchst du es noch einmal.", action: nil, done: false)
            case .loaded:
                let rows = setup.rows
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, check in
                    checkRow(check)
                    if index < rows.count - 1 { Divider() }
                }
            }
        }
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
        .frame(maxWidth: Theme.Metrics.pt480)
    }

    private func checkRow(_ check: HealthCheck) -> some View {
        let ok = check.state == .ok
        let detail = ok ? "Bereit." : (check.fix ?? (check.optional ? "Optional, später nachholbar." : "Fehlt noch."))
        return row(check.label, detail: detail, action: ok ? nil : ("Einrichten", { model.settings.section = .setup; openSettings() }), done: ok)
    }

    private func row(_ title: String, detail: String, action: (String, () -> Void)?, done: Bool) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                Text(title).font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt20))
                Text(detail).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading)
            if let action { Button(action.0, action: action.1).buttonStyle(OnboardingStepButtonStyle(prominent: false, compact: true)) }
            else if done { Image(systemName: "checkmark").font(.system(size: Theme.Metrics.pt12, weight: .semibold)).foregroundStyle(Theme.Palette.mutedForeground) }
        }.padding(.vertical, Theme.Metrics.pt10).padding(.horizontal, Theme.Spacing.md)
    }
}
