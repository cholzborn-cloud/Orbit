import SwiftUI

// Dialog „Neuer Orbi“ / „Orbi bearbeiten“ nach Figma 119:24197: Reiter Form (Form, Farbe) und Personalisieren (Gruppe „Profil“).
// Alle Änderungen zeigen sich sofort in der Vorschau; gespeichert wird erst mit dem Knopf.
struct BotEditorView: View {
    @Bindable var editor: BotEditorModel
    let onSave: () -> Void
    let onCancel: () -> Void
    // Löschen gibt es nur im Kontextmenü (Antwort 6); Parameter bleibt für bestehende Aufrufer.
    let onDelete: (() -> Void)?

    var body: some View {
        DialogShell(
            title: editor.editing == nil ? "Neuer Orbi" : "Orbi bearbeiten", description: "Gib ihm ein Gesicht, einen Namen und eine Aufgabe.",
            height: Theme.Metrics.pt560, onClose: onCancel
        ) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
                WebTabs(tabs: Array(BotEditorModel.Tab.allCases), selection: $editor.tab) { $0.rawValue }
                switch editor.tab {
                case .profile: ProfileTab(editor: editor, appearanceOnly: true)
                case .look: ProfileTab(editor: editor, profileOnly: true)
                }
            }
        } footer: {
            if let error = editor.error {
                Text(error).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.destructive).lineLimit(2)
            }
            Button("Abbrechen", action: onCancel).buttonStyle(.card(.outline)).keyboardShortcut(.cancelAction)
            Button(editor.editing == nil ? "Orbi erstellen" : "Speichern", action: onSave)
                .buttonStyle(.card(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(editor.saving || editor.validationMessage != nil)
        }
    }
}

// Form und Farbe (appearanceOnly) bzw. Gruppe „Profil“ (profileOnly); ohne Angabe beides.
struct ProfileTab: View {
    @Bindable var editor: BotEditorModel
    var appearanceOnly = false
    var profileOnly = false
    @State private var pendingMain = false

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            if !profileOnly {
                shapes
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5)   // Figma 119:24197: Linie 0,5
                colors
            }
            if !appearanceOnly {
                if pendingMain, let replaced = editor.others.first(where: { $0.isMain }) {
                    MainOrbiWarning(old: replaced.name, new: editor.name, look: editor.look) {
                        editor.setMain(true); pendingMain = false
                    } cancel: { pendingMain = false }
                        .frame(maxWidth: .infinity)
                } else {
                    profileGroup
                    jobPills
                }
            }
        }
    }

    // Formen etwas kleiner als zuvor; 5 je Reihe, zentriert.
    private var shapes: some View {
        let rows = stride(from: 0, to: OrbiShape.allCases.count, by: 5).map { Array(OrbiShape.allCases[$0..<min($0 + 5, OrbiShape.allCases.count)]) }
        return VStack(spacing: Theme.Metrics.pt12) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: Theme.Metrics.pt0) {
                    ForEach(rows[index], id: \.self) { shape in
                        ShapeTile(look: preview(shape), name: shape.displayName, selected: editor.shape == shape) { editor.shape = shape }
                            .probe("orbi-shape-" + shape.rawValue)
                        if shape != rows[index].last { Spacer(minLength: Theme.Metrics.pt0) }
                    }
                    if rows[index].count < 5 { Spacer(minLength: Theme.Metrics.pt0) }
                }
            }
        }
    }

    // Farben deutlich kleiner: 22, 8 je Reihe, beide Reihen zentriert.
    private var colors: some View {
        let presets = BotEditorModel.colorPresets
        let rows = stride(from: 0, to: presets.count, by: 8).map { Array(presets[$0..<min($0 + 8, presets.count)]) }
        return VStack(spacing: Theme.Metrics.pt8) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: Theme.Metrics.pt6) {
                    ForEach(rows[index], id: \.self) { hex in
                        let color = Theme.OrbiColor.lookup(hex: hex)
                        swatch(selected: Theme.OrbiColor.lookup(hex: editor.look.bodyHex)?.name == color?.name, label: color?.displayName ?? hex, white: color?.name == "weiss") { editor.useColor(hex: hex) } content: {
                            Circle().fill(color?.color ?? Theme.Palette.muted)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    // Figma „Profil“ (119:24197): Gruppe card r10, Rand 0,5, Trenner 0,5; Zeilen 38, innen 0/12; Bezeichnung 13, Wert 13 muted.
    private var profileGroup: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            groupRow("Name") {
                TextField("Dein Orbi", text: $editor.name, prompt: Text("Dein Orbi").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).multilineTextAlignment(.trailing)
                    .font(Theme.Fonts.geist(Theme.Fonts.size13)).foregroundStyle(Theme.Palette.mutedForeground)
            }
            divider
            groupRow("Hauptorbi") {
                Toggle("Hauptorbi", isOn: Binding(get: { editor.isMain }, set: { on in
                    // Figma 122:28173: Warnung beim Einschalten; „Abbrechen“ lässt den Schalter aus.
                    if on, editor.others.contains(where: { $0.isMain }) { pendingMain = true } else { editor.setMain(on) }
                })).labelsHidden().toggleStyle(WebSwitchStyle())
            }
        }
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }

    private var jobPills: some View {
        let jobs = JobPresets.all.map(\.job) + [JobPresets.custom]
        return VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            Text("Aufgabe").font(Theme.Fonts.geist(Theme.Fonts.size13))
            WrappingHStack(spacing: Theme.Metrics.pt6, lineSpacing: Theme.Metrics.pt6) {
                ForEach(jobs, id: \.self) { job in
                    let selected = job == JobPresets.custom ? editor.isCustomJob : (!editor.isCustomJob && editor.job == job)
                    Button {
                        editor.selectPreset(job == JobPresets.custom ? nil : job)
                    } label: {
                        Text(job)
                            .font(selected ? Theme.Fonts.smallMedium : Theme.Fonts.small)
                            .foregroundStyle(Theme.Palette.foreground)
                            .padding(.horizontal, Theme.Metrics.pt10).frame(height: Theme.Metrics.pt28)
                            .background(selected ? Theme.Palette.secondary : Theme.Palette.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(selected ? Theme.Palette.foreground : Theme.Palette.border, lineWidth: selected ? Theme.Metrics.pt1 : Theme.Metrics.pt0_5))
                    }
                    .buttonStyle(.plain)
                    .disabled(editor.isMain)
                    .opacity(editor.isMain ? 0.45 : 1)
                    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                }
            }
            if editor.isCustomJob && !editor.isMain {
                TextField("Begleiter", text: $editor.job, prompt: Text("Begleiter").foregroundStyle(Theme.Palette.mutedForeground))
                    .textFieldStyle(.plain)
                    .font(Theme.Fonts.geist(Theme.Fonts.size13))
                    .padding(.horizontal, Theme.Metrics.pt10).frame(height: Theme.Metrics.pt32)
                    .background(Theme.Palette.field, in: .rect(cornerRadius: Theme.Radius.field))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.field).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var divider: some View { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }

    private func groupRow<Value: View>(_ title: String, @ViewBuilder value: () -> Value) -> some View {
        HStack(spacing: Theme.Metrics.pt8) {
            Text(title).font(Theme.Fonts.geist(Theme.Fonts.size13))
            Spacer(minLength: Theme.Metrics.pt8)
            value()
        }
        .padding(.horizontal, Theme.Metrics.pt12).frame(height: Theme.Metrics.pt38)
    }

    // Web: jede Kachel in der Farbe ihrer Form, nur die gewählte in der gewählten Farbe.
    private func preview(_ shape: OrbiShape) -> OrbiLook {
        let tinted = editor.customColor
        var look = OrbiLook(avatar: shape.serviceName, colorHex: tinted ? editor.form.color : editor.shape.baseHex)
        look.accessory = .none
        return look
    }

    // Figma Farbfeld (118:23351): 36, gewählt Rand 1,5 foreground direkt am Feld; Rand sonst nur beim weißen Feld im Hellmodus (O10).
    @Environment(\.colorScheme) private var scheme
    private func swatch<Content: View>(selected: Bool, label: String, white: Bool, action: @escaping () -> Void, @ViewBuilder content: () -> Content) -> some View {
        Button(action: action) {
            content().frame(width: Theme.Metrics.pt22, height: Theme.Metrics.pt22)
                .overlay(Circle().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5).opacity(white && scheme == .light ? 1 : 0))
                .overlay(Circle().strokeBorder(selected ? Theme.Palette.swatchRing : .clear, lineWidth: Theme.Metrics.pt1_5))
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .webTooltip(label)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// Hauptorbi-Warnung als eigene Karte (Figma 122:28173): popover r14, 260 breit, innen 22/20/16/20, Abstand 8, Orbi 40,
// Titel 13 Semibold, Text 12/16 muted, Knöpfe untereinander 28 hoch.
struct MainOrbiWarning: View {
    let old: String
    let new: String
    let look: OrbiLook
    let confirm: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(spacing: Theme.Metrics.pt8) {
            OrbiFigure(look: look).frame(width: Theme.Metrics.pt40, height: Theme.Metrics.pt40)
            Text("Neuer Hauptorbi?").font(Theme.Fonts.geist(Theme.Fonts.size13, .semibold))
            Text("\(old) ist gerade dein Hauptorbi. Wenn du \(new) zum Hauptorbi machst, ist \(old) es nicht mehr.")
                .font(Theme.Fonts.small).lineSpacing(Theme.Metrics.pt4).multilineTextAlignment(.center)
                .foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
            VStack(spacing: Theme.Metrics.pt8) {
                Button(action: confirm) { Text("Hauptorbi wechseln").font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.background).frame(maxWidth: .infinity).frame(height: Theme.Metrics.pt28).background(Theme.Palette.foreground, in: .capsule) }
                Button(action: cancel) { Text("Abbrechen").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.secondaryForeground).frame(maxWidth: .infinity).frame(height: Theme.Metrics.pt28).background(Theme.Palette.secondary, in: .capsule) }
            }
            .buttonStyle(.plain).padding(.top, Theme.Metrics.pt4)
        }
        .padding(.top, Theme.Metrics.pt22).padding(.horizontal, Theme.Metrics.pt20).padding(.bottom, Theme.Metrics.pt16)
        .frame(width: Theme.Metrics.pt260)
        .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Radius.xl))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xl).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }
}

// Formen-Kachel (Web): bg-muted/50, Ring 1 foreground/10, Hover bg-muted (150 ms); gewählt primary/20 mit Ring 2 primary.
// Ringe liegen wie box-shadow außen.
private struct ShapeTile: View {
    let look: OrbiLook
    let name: String
    let selected: Bool
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            // Form-Kachel etwas kleiner: 40, Figur 32, r12; Hover glass, gewählt glassActive.
            OrbiFigure(look: look).environment(\.figuresStatic, true)
                .frame(width: Theme.Metrics.pt32, height: Theme.Metrics.pt32)
                .frame(width: Theme.Metrics.pt40, height: Theme.Metrics.pt40)
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


private struct WrappingHStack: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        layout(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(bounds.width, subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func layout(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += row + lineSpacing
                row = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            row = max(row, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: min(max(maxX, 0), width), height: y + row), origins)
    }
}
