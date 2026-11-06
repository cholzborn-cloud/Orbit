import SwiftUI
import UserNotifications

extension EnvironmentValues {
    @Entry var onboardingNamespace: Namespace.ID?
}

struct OnboardingFigure: ViewModifier {
    @Environment(\.onboardingNamespace) private var namespace
    func body(content: Content) -> some View {
        if let namespace { content.matchedGeometryEffect(id: "first-orbi", in: namespace) }
        else { content }
    }
}

// Erster leerer Start: die Auswahl wird erst mit „Loslegen“ gespeichert.
struct OnboardingView: View {
    let model: AppModel
    @State private var step = 0
    @State private var editor = BotEditorModel(editing: nil, others: [])
    @State private var error: String?
    @State private var saving = false
    @State private var notificationsAllowed = false
    @Environment(\.openSettings) private var openSettings
    @Environment(\.staticRendering) private var staticRendering
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    init(model: AppModel, initialStep: Int = 0) {
        self.model = model
        _step = State(initialValue: min(4, max(0, initialStep)))
        let editor = BotEditorModel(editing: nil, others: [])
        editor.useColor(hex: OrbiShape.strobi.baseHex)
        _editor = State(initialValue: editor)
    }

    // Figma Onboarding (164:116621): je Schritt eigene Abstände. 1/5: Figur 160, 32, Titel, 8, Text, 28, Knopf.
    // 2a: Punkte, 20, Titel, 8, Text, 28, Gestalten, 28, Knöpfe. 3/4: Punkte, 20, Figur 56, 16, Titel, 8, Text, 28, Inhalt, 28, Knöpfe.
    var body: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            if step > 0 && step < 4 {
                HStack(spacing: Theme.Metrics.pt6) {
                    ForEach(1...3, id: \.self) { index in
                        Circle().fill(index == step ? Theme.Palette.foreground : Theme.Palette.border)
                            .frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6)
                    }
                }.accessibilityLabel("Schritt \(step) von 3")
                .padding(.bottom, Theme.Metrics.pt20)
            }
            if step != 1 {
                OrbiFigure(look: editor.look, state: step == 4 ? .done : .calm, live: true, follow: true, role: .editor)
                    .frame(width: figureSize, height: figureSize)
                    .modifier(OnboardingFigure())
                    .overlay { if step == 4 { OnboardingSparkles().allowsHitTesting(false) } }
                    .padding(.bottom, step == 0 || step == 4 ? Theme.Spacing.xxl : Theme.Spacing.lg)
            }
            VStack(spacing: Theme.Spacing.sm) {
                Text(title).font(Theme.Fonts.largeTitle).foregroundStyle(Theme.Palette.foreground)
                Text(subtitle).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
            }
            Group {
                if step == 1 { appearance }
                if step == 2 { accesses }
                if step == 3 { ScrollView { services }.frame(maxHeight: .infinity) }
            }
            .padding(.top, Theme.Metrics.pt28)
            if let error { InlineAlert(text: error).frame(maxWidth: Theme.Metrics.pt480).padding(.top, Theme.Spacing.md) }
            HStack(spacing: Theme.Spacing.sm) {
                if step > 0 && step < 4 {
                    Button("Zurück") { move(-1) }.buttonStyle(OnboardingStepButtonStyle(prominent: false))
                }
                Button(step == 0 ? "Los geht’s" : step == 3 ? "Fertig" : step == 4 ? "Loslegen" : "Weiter") {
                    if step == 4 { create() } else { move(1) }
                }
                .buttonStyle(OnboardingStepButtonStyle(prominent: true, large: step == 0 || step == 4)).disabled(saving)
            }
            .padding(.top, Theme.Metrics.pt28)
        }
        .padding(Theme.Spacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.Palette.background)
        .foregroundStyle(Theme.Palette.foreground)
        .font(Theme.Fonts.body)
        .animation(reduceMotion ? nil : Theme.Motion.enter.animation, value: step)
        .probe("onboarding-step-\(step)")
    }

    private var figureSize: CGFloat { step == 0 || step == 4 ? Theme.Metrics.pt160 : Theme.Metrics.pt56 }
    private var title: String {
        switch step {
        case 0: "Willkommen bei Orbit"
        case 1: "Gib ihm ein Gesicht"
        case 2: "Ein paar Zugriffe"
        case 3: "Womit soll \(editor.name) arbeiten?"
        default: "\(editor.name) ist bereit!"
        }
    }
    private var subtitle: String {
        switch step {
        case 0: "Deine kleinen Helfer auf dem Mac."
        case 1: "Wähle Form und Farbe."
        case 2: "Damit \(editor.name) dir Bescheid geben kann."
        case 3: "Verbinde, was du schon nutzt."
        default: "Dein erster Orbi ist startklar."
        }
    }

    private var appearance: some View {
        // Figma 2a (164:116652): Abstand 24; Vorschau 280 breit, Figur 120, Abstand 12.
        HStack(spacing: Theme.Spacing.xl) {
            VStack(spacing: Theme.Spacing.md) {
                OrbiFigure(look: editor.look, live: true, follow: true, role: .editor)
                    .frame(width: Theme.Metrics.pt120, height: Theme.Metrics.pt120)
                Text(editor.name).font(Theme.Fonts.bodyMedium)
                Text("Die Augen folgen deinem Zeiger.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
            }.frame(width: Theme.Metrics.pt280)
            VStack(spacing: Theme.Spacing.lg) {
                // Reiter „Form“ (118:24125): 13 Medium, innen 6/10, glassActive.
                Text("Form").font(Theme.Fonts.geist(Theme.Fonts.size13, .medium))
                    .padding(.horizontal, Theme.Metrics.pt10).padding(.vertical, Theme.Metrics.pt6)
                    .background(Theme.Palette.glassActive, in: .capsule)
                // Formkacheln 48 (Figur 38, r12, gewählt glassActive), 5 je Reihe bündig verteilt, Zeilenabstand 14.
                VStack(spacing: Theme.Metrics.pt14) {
                    ForEach(Array(stride(from: 0, to: OrbiShape.allCases.count, by: 5)), id: \.self) { start in
                        HStack(spacing: Theme.Metrics.pt0) {
                            ForEach(Array(OrbiShape.allCases[start..<min(start + 5, OrbiShape.allCases.count)].enumerated()), id: \.element) { offset, shape in
                                if offset > 0 { Spacer(minLength: Theme.Metrics.pt0) }
                                OnboardingShapeTile(look: preview(shape), name: shape.displayName, selected: editor.shape == shape) { editor.shape = shape }
                            }
                        }
                    }
                }
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)
                // Farbfelder (118:23347): Feld 30, außen 36, Auswahlring foreground 1,5; 8 je Reihe zentriert, Abstand 4,5, Zeilen 10.
                VStack(spacing: Theme.Metrics.pt10) {
                    ForEach(Array(stride(from: 0, to: Theme.OrbiColor.all.count, by: 8)), id: \.self) { start in
                        HStack(spacing: Theme.Metrics.pt4_5) {
                            ForEach(Theme.OrbiColor.all[start..<min(start + 8, Theme.OrbiColor.all.count)], id: \.lightHex) { color in
                                let selected = editor.form.color == color.lightHex || (!editor.customColor && editor.shape == .strobi && color.lightHex == Theme.OrbiColor.lookup(hex: OrbiShape.strobi.baseHex)?.lightHex)
                                Button { editor.useColor(hex: color.lightHex) } label: {
                                    Circle().fill(color.color).frame(width: Theme.Metrics.pt30, height: Theme.Metrics.pt30)
                                        // O10: Rand nur beim weißen Feld im Hellmodus.
                                        .overlay { if color.name == "weiss" && scheme == .light { Circle().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) } }
                                        .padding(Theme.Metrics.pt3)
                                        .overlay { if selected { Circle().strokeBorder(Theme.Palette.foreground, lineWidth: Theme.Metrics.pt1_5) } }
                                }.buttonStyle(.plain).accessibilityLabel(color.displayName)
                                    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                            }
                        }
                    }
                }
            }
            .padding(Theme.Spacing.lg)
            .frame(width: Theme.Metrics.pt360)
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.xl2))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.xl2).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
        }
    }

    private func preview(_ shape: OrbiShape) -> OrbiLook {
        OrbiLook(avatar: shape.serviceName, colorHex: editor.form.color ?? OrbiShape.strobi.baseHex)
    }

    private var accesses: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            // O13: erlaubt = Punkt statusInfo 6 + „Erlaubt“ 13 statt Knopf.
            accessRow("Mitteilungen", detail: "Bei Freigaben, Rückfragen und fertigen Routinen, wenn Orbit nicht vorne ist.", action: notificationsAllowed ? nil : "Erlauben", allowed: notificationsAllowed) {
                Task {
                    do { notificationsAllowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
                    catch { self.error = error.localizedDescription }
                }
            }
            Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)
            accessRow("Im Hintergrund laufen", detail: "Startet bei der Anmeldung und nach einem Absturz von selbst.", action: "Einrichten") { settings(.setup) }
        }
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
        .frame(maxWidth: Theme.Metrics.pt480)
    }

    private static let providers: [(name: String, maker: String, letter: String)] = [("Claude", "Anthropic", "A"), ("Codex", "OpenAI", "O"), ("Antigravity", "Google", "G")]
    private static let connectorNotes = [
        "deepwiki": "Fragt öffentliche Dokumentation zu GitHub-Repositories über MCP ab.",
        "context7": "Liefert öffentliche Bibliotheksdokumentation über MCP."
    ]

    private var services: some View {
        let settingsStore = model.settings
        // Figma 4 (169:124335): Gruppen-Abstand 20; Label 12 Medium muted, links 12 eingerückt, 8 bis zur Box.
        return VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("KI-Konten").font(Theme.Fonts.smallMedium).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground).padding(.leading, Theme.Spacing.md)
            card {
                ForEach(Array(Self.providers.enumerated()), id: \.offset) { index, provider in
                    HStack(spacing: Theme.Spacing.md) {
                        // Konto-Logo (169:123843): 20 × 20 r6, secondary, Buchstabe 11 Semibold foreground.
                        Text(provider.letter).font(Theme.Fonts.geist(Theme.Fonts.size11, .semibold)).foregroundStyle(Theme.Palette.foreground)
                            .frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
                            .background(Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Radius.sm))
                        rowText(provider.name, detail: provider.maker)
                        Button("Anmelden") { settings(.setup) }.buttonStyle(OnboardingStepButtonStyle(prominent: false, compact: true))
                    }.padding(.vertical, Theme.Metrics.pt10).padding(.horizontal, Theme.Spacing.md)
                    if index < Self.providers.count - 1 { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
                }
            }
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Konnektoren").font(Theme.Fonts.smallMedium).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground).padding(.leading, Theme.Spacing.md)
            card {
                ForEach(settingsStore.connectors.value ?? []) { connector in
                    HStack(spacing: Theme.Spacing.md) {
                        rowText(connector.name, detail: Self.connectorNotes[connector.id] ?? connector.host)
                        Toggle("\(connector.name) aktiv", isOn: Binding(get: { connector.enabled }, set: { on in Task { await settingsStore.setEnabled(connector.id, on) } }))
                            .toggleStyle(WebSwitchStyle()).labelsHidden()
                    }.padding(.vertical, Theme.Metrics.pt10).padding(.horizontal, Theme.Spacing.md)
                    Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)
                }
                // „Konnektor hinzufügen“ (169:124356): 36 hoch, innen 10/12, 13 Regular.
                Button { settings(.connectors) } label: {
                    HStack(spacing: Theme.Spacing.sm) {
                        Image(systemName: "plus").font(.system(size: Theme.Metrics.pt12, weight: .medium))
                        Text("Konnektor hinzufügen").font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt16))
                        Spacer(minLength: Theme.Metrics.pt0)
                    }.padding(.horizontal, Theme.Spacing.md).frame(height: Theme.Metrics.pt36).contentShape(.rect)
                }.buttonStyle(.plain)
            }
            }
            if let skills = settingsStore.skills.value, !skills.isEmpty {
                card {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text("\(skills.count) Fähigkeiten sind schon an Bord").font(Theme.Fonts.bodyMedium)
                        Text(skills.map(\.description).prefix(5).joined(separator: ", ")).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(Theme.Spacing.md)
                }
            }
        }
        .frame(maxWidth: Theme.Metrics.pt480)
        .task { guard !staticRendering else { return }; await settingsStore.loadConnectors(); await settingsStore.loadSkills() }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: Theme.Metrics.pt0) { content() }
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
    }

    // Zugriff-/Konto-Zeile (169:124255): innen 10/12, Titel 14 Medium/20, Detail 12/16, Abstand 2.
    private func rowText(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
            Text(title).font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt20))
            Text(detail).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func accessRow(_ title: String, detail: String, action: String?, allowed: Bool = false, run: @escaping () -> Void) -> some View {
        HStack(spacing: Theme.Spacing.md) {
            rowText(title, detail: detail)
            if let action { Button(action, action: run).buttonStyle(OnboardingStepButtonStyle(prominent: false, compact: true)) }
            else if allowed {
                HStack(spacing: Theme.Metrics.pt6) {
                    Circle().fill(Theme.Status.info).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6)
                    Text("Erlaubt").font(Theme.Fonts.subhead)
                }
            }
        }.padding(.vertical, Theme.Metrics.pt10).padding(.horizontal, Theme.Spacing.md)
    }

    private func settings(_ section: SettingsSection) { model.settings.section = section; openSettings() }
    private func move(_ delta: Int) { error = nil; step = min(4, max(0, step + delta)) }
    private func create() {
        guard !saving else { return }
        if let message = editor.validationMessage { error = message; return }
        saving = true
        model.creatingFirstOrbi = true
        Task {
            defer { saving = false; model.creatingFirstOrbi = false }
            do {
                let bot = try await model.botStore.create(editor.form)
                withAnimation(reduceMotion ? nil : Theme.Motion.enter.animation) {
                    model.selection = .bot(bot.id)
                    model.finishOnboarding()
                }
                model.startOnboarding(botId: bot.id, chatId: bot.chatId)
            } catch { self.error = error.localizedDescription }
        }
    }
}

// Kapselknöpfe der Einrichtung und des Onboardings (Figma Onboarding 1–5): „prominent“ schwarz (foreground), sonst grau (secondary).
// Kapselknöpfe der Einrichtung „Alles bereit?“ (ohne eigene Figma-Vorlage, unverändert).
struct OnboardingButtonStyle: ButtonStyle {
    var prominent: Bool
    var compact = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? Theme.Fonts.smallMedium : Theme.Fonts.bodyMedium)
            .foregroundStyle(prominent ? Theme.Palette.background : Theme.Palette.secondaryForeground)
            .padding(.horizontal, compact ? Theme.Metrics.pt10 : Theme.Metrics.pt14)
            .frame(height: compact ? Theme.Metrics.pt24 : Theme.Metrics.pt28)
            .background(prominent ? Theme.Palette.foreground : Theme.Palette.secondary, in: .capsule)
            .opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
            .contentShape(.capsule)
    }
}

// Figma Onboarding: Knöpfe in 2a/3/4 und „Anmelden/Erlauben“ 24 hoch, Regular 12, innen 12; „Los geht’s“/„Loslegen“ 34 hoch,
// Regular 13, innen 20. Zweit gedrückt input, deaktiviert 40 %.
struct OnboardingStepButtonStyle: ButtonStyle {
    var prominent: Bool
    var compact = false
    var large = false

    func makeBody(configuration: Configuration) -> some View { StepBody(configuration: configuration, style: self) }

    private struct StepBody: View {
        let configuration: ButtonStyleConfiguration
        let style: OnboardingStepButtonStyle
        @Environment(\.isEnabled) private var enabled
        @State private var hover = false

        var body: some View {
            // O5: Zweit-Knopf bei Hover secondaryHover, gedrückt input.
            let second: Color = configuration.isPressed ? Theme.Palette.input : (hover && enabled ? Theme.Palette.secondaryHover : Theme.Palette.secondary)
            configuration.label
                .font(style.large ? Theme.Fonts.subhead : Theme.Fonts.small)
                .foregroundStyle(style.prominent ? Theme.Palette.background : Theme.Palette.secondaryForeground)
                .padding(.horizontal, style.large ? Theme.Metrics.pt20 : Theme.Metrics.pt12)
                .frame(height: style.large ? Theme.Metrics.pt34 : Theme.Metrics.pt24)
                .background(style.prominent ? Theme.Palette.foreground : second, in: .capsule)
                .opacity(enabled ? 1 : Theme.Opacity.disabled)
                .contentShape(.capsule)
                .onHover { hover = $0 }
                .animation(Theme.Motion.hover.animation, value: hover)
        }
    }
}

// Formkachel im Onboarding (Figma 118:23346): 48, Figur 38, r12; Hover glass, gewählt glassActive; Tooltip mit dem Formnamen (O10).
private struct OnboardingShapeTile: View {
    let look: OrbiLook
    let name: String
    let selected: Bool
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            OrbiFigure(look: look, role: .editor)
                .frame(width: Theme.Metrics.pt38, height: Theme.Metrics.pt38)
                .padding(Theme.Metrics.pt5)
                .background(selected ? Theme.Palette.glassActive : hover ? Theme.Palette.glass : .clear, in: .rect(cornerRadius: Theme.Radius.row))
                .contentShape(.rect(cornerRadius: Theme.Radius.row))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: hover)
        .webTooltip(name)
        .accessibilityLabel(name)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// Funkeln um die Figur im Abschluss (Figma Onboarding 5): vierzackige Sterne in Gelb, Flieder, Türkis, Rosa und Mint.
private struct OnboardingSparkles: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false
    var body: some View {
        GeometryReader { proxy in
            let side = proxy.size.width
            ForEach(Array(Theme.Onboarding.sparkles.enumerated()), id: \.offset) { _, star in
                SparkleShape().fill(star.color)
                    .frame(width: side * star.size, height: side * star.size)
                    .scaleEffect(on ? 1 : Theme.Onboarding.sparkleScale).opacity(on ? 1 : Theme.Onboarding.sparkleDimOpacity)
                    .animation(reduceMotion ? nil : Theme.Motion.onboardingSparkle.delay(star.delay), value: on)
                    .position(x: side * (0.5 + star.x), y: proxy.size.height * (0.5 + star.y))
            }
        }
        .onAppear { on = true }
    }
}

private struct SparkleShape: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY), r = rect.width / 2, k = r * Theme.Onboarding.sparkleCurve
        var p = Path()
        p.move(to: CGPoint(x: c.x, y: c.y - r))
        p.addQuadCurve(to: CGPoint(x: c.x + r, y: c.y), control: CGPoint(x: c.x + k, y: c.y - k))
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y + r), control: CGPoint(x: c.x + k, y: c.y + k))
        p.addQuadCurve(to: CGPoint(x: c.x - r, y: c.y), control: CGPoint(x: c.x - k, y: c.y + k))
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y - r), control: CGPoint(x: c.x - k, y: c.y - k))
        return p
    }
}
