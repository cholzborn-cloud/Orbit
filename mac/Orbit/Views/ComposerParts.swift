import AppKit
import SwiftUI

// Bausteine des Composers (4c), Maße aus der Web-UI gemessen (plan/tools/measure-composer.mjs, Fenster 1280, Dunkel):
// Werkzeugknöpfe 32 × 32 r 10, Auslöser 32 hoch (13/500, Innenabstand 8, Abstand 6), Modellpanel 256, Slash-Menü 384.

// Werkzeugknopf (Web: PromptInputButton, ghost): muted, Hover muted-Fläche + foreground.
struct ComposerToolStyle: ButtonStyle {
    var active = false
    func makeBody(configuration: Configuration) -> some View { ToolBody(configuration: configuration, active: active) }

    private struct ToolBody: View {
        let configuration: ButtonStyleConfiguration
        let active: Bool
        @State private var hover = false
        @Environment(\.isEnabled) private var enabled
        @Environment(\.isFocused) private var focused

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: Theme.Radius.lg)
            configuration.label
                .foregroundStyle(hover || active ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                .frame(width: Theme.Metrics.pt32, height: Theme.Metrics.pt32)
                .background(hover || active ? Theme.Palette.muted : .clear, in: shape)
                .contentShape(shape)
                .overlay { if focused { shape.strokeBorder(Theme.Palette.ring, lineWidth: Theme.Metrics.pt1) } }
                .opacity(enabled ? 1 : 0.5)
                .offset(y: configuration.isPressed ? Theme.Motion.pressOffset : 0)
                .focusEffectDisabled()
                .onHover { hover = $0 && enabled }
                .animation(Theme.Motion.hover.animation, value: hover)
        }
    }
}

// Auslöser mit Text und Chevron (Web: TRIGGER in model-picker.tsx und approval-mode-picker.tsx).
struct ComposerTrigger<Leading: View>: View {
    let title: String
    var detail: String?
    var detailGold = false
    let open: Bool
    @ViewBuilder let leading: Leading
    @State private var hover = false

    var body: some View {
        let lit = hover || open
        HStack(spacing: Theme.Metrics.pt6) {
            leading
            Text(title).font(Theme.Fonts.geist(Theme.Fonts.size13, .medium)).lineLimit(1)
            if let detail {
                Text(detail).font(Theme.Fonts.geist(Theme.Fonts.size13, .medium))
                    .foregroundStyle(Theme.Palette.mutedForeground.opacity(0.8)).lineLimit(1)
                    .goldText(detailGold)
            }
            Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt9, weight: .semibold)).opacity(0.6)
                .rotationEffect(.degrees(open ? 180 : 0))
        }
        .foregroundStyle(lit ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
        .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt32)
        .background(lit ? Theme.Palette.muted : .clear, in: .rect(cornerRadius: Theme.Radius.lg))
        .contentShape(.rect(cornerRadius: Theme.Radius.lg))
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: lit)
    }
}

// MARK: Modellpanel (Web: ModelPicker, EffortPanel mit Kapsel-Regler)

struct ModelPanel: View {
    @Bindable var composer: ComposerModel
    @State private var listOpen = false
    @State private var drag = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.screenAction) private var screenAction

    private var levels: [String] { composer.isAuto ? [] : (composer.selectedModel?.efforts ?? []) }
    // Höchste Stufe eines Modells mit mehreren Stufen (Web: isMax) färbt Zahl, Regler und Beschriftung golden.
    private var isMax: Bool { !composer.isAuto && levels.count > 1 && composer.effort == levels.last }

    var body: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            if listOpen { list }
            header
        }
        .animation(reduceMotion ? nil : Theme.Motion.pop.animation, value: listOpen)
        .onAppear { if screenAction == "modell-liste" { listOpen = true } }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            option("Auto (Jev)", active: composer.isAuto, jev: true) { composer.select(model: ModelInfo.autoId) }
            ForEach(ModelInfo.providerOrder, id: \.self) { provider in
                let items = composer.models.filter { $0.provider == provider }
                if !items.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                        Rectangle().fill(Theme.Palette.foreground.opacity(0.05)).frame(height: Theme.Metrics.pt1).padding(.top, Theme.Metrics.pt4)
                        HStack(spacing: Theme.Metrics.pt6) {
                            ProviderIcon(provider: provider, size: Theme.Metrics.pt12)
                            Text(ModelInfo.providerNames[provider] ?? provider).font(Theme.Fonts.geist(Theme.Fonts.size10_5, .medium))
                        }
                        .foregroundStyle(Theme.Palette.mutedForeground)
                        .padding(.horizontal, Theme.Metrics.pt10).padding(.top, Theme.Metrics.pt6).padding(.bottom, Theme.Metrics.pt2)
                        ForEach(items) { model in option(model.label, active: model.id == composer.modelId) { composer.select(model: model.id) } }
                    }
                }
            }
            if composer.models.isEmpty { Text(emptyReason).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).padding(Theme.Metrics.pt10) }
        }
    }

    private var emptyReason: String {
        if case .failed(let text) = composer.catalog { return "Modelle konnten nicht geladen werden: \(text)" }
        return composer.modelsAvailable ? "Keine Modelle gemeldet." : "Keine Modelle verfügbar: Claude, Codex oder Gemini sind nicht angemeldet (siehe Einrichtung)."
    }

    private func option(_ title: String, active: Bool, jev: Bool = false, note: String? = nil, action: @escaping () -> Void) -> some View {
        OptionRow(title: title, active: active, jev: jev, note: note, action: action)
    }

    private var header: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            Button { listOpen.toggle() } label: {
                ZStack(alignment: .trailing) {
                    VStack(spacing: Theme.Metrics.pt2) {
                        Text(composer.isAuto ? "Jev" : (composer.effort.flatMap { ModelInfo.effortLabels[$0] } ?? composer.modelTitle))
                            .font(Theme.Fonts.geist(Theme.Fonts.size20, .medium)).foregroundStyle(composer.isAuto || composer.effort != nil ? Theme.Palette.primary : Theme.Palette.mutedForeground)
                            .goldText(isMax)
                        Text(composer.isAuto ? "Automatische Modellwahl" : (composer.effort == nil ? "" : composer.modelTitle))
                            .font(Theme.Fonts.geist(Theme.Fonts.size13)).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                    Image(systemName: "chevron.up").font(.system(size: Theme.Metrics.pt11, weight: .medium)).foregroundStyle(Theme.Palette.mutedForeground)
                        .rotationEffect(.degrees(listOpen ? 180 : 0)).padding(.trailing, Theme.Metrics.pt4)
                }
                .padding(.vertical, Theme.Metrics.pt6).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Modellliste \(listOpen ? "schließen" : "öffnen")")
            if levels.count > 1 { slider.padding(.top, Theme.Metrics.pt8) }
            else if !composer.isAuto, composer.selectedModel != nil {
                Text("Dieses Modell hat keine einstellbare Denktiefe.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).padding(.top, Theme.Metrics.pt8)
            }
        }
        .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt8)
        .jevSweep(composer.isAuto)
        .overlay(alignment: .top) { if listOpen { Rectangle().fill(Theme.Palette.foreground.opacity(0.05)).frame(height: Theme.Metrics.pt1).padding(.horizontal, Theme.Metrics.pt8) } }
    }

    // Kapsel-Regler: Schiene 38, Griff 34 mit 2 Abstand, Punkte 6; Beschriftung darunter, die gewählte hervorgehoben.
    private var slider: some View {
        // Werte fest einfangen: beim Wechsel auf „Auto“ ist `levels` leer, während die alte ForEach-Runde noch läuft.
        let levels = self.levels
        let count = levels.count
        let index = levels.firstIndex(of: composer.effort ?? "") ?? 0
        return VStack(spacing: Theme.Metrics.pt6) {
            GeometryReader { box in
                let travel = max(1, box.size.width - Theme.Metrics.pt38)
                let position = { (i: Int) -> CGFloat in Theme.Metrics.pt19 + travel * CGFloat(i) / CGFloat(max(1, count - 1)) }
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.Palette.foreground.opacity(0.10))
                    Capsule().strokeBorder(Theme.Palette.foreground.opacity(0.15), lineWidth: Theme.Metrics.pt1)
                    Group { if isMax { GoldGradient() } else { Theme.Palette.primary } }
                        .clipShape(.capsule).frame(width: position(index) + Theme.Metrics.pt19)
                        .animation(drag || reduceMotion ? nil : Theme.Motion.hover.animation, value: index)
                    ForEach(Array(0..<count), id: \.self) { i in
                        Circle().fill(i < index ? Theme.Palette.primaryForeground.opacity(0.6) : Theme.Palette.foreground.opacity(0.3))
                            .frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6).position(x: position(i), y: Theme.Metrics.pt19)
                    }
                    thumb
                        .position(x: position(index), y: Theme.Metrics.pt19)
                        .animation(drag || reduceMotion ? nil : Theme.Motion.hover.animation, value: index)
                }
                .contentShape(.rect)
                .gesture(DragGesture(minimumDistance: Theme.Metrics.pt0).onChanged { value in
                    drag = true
                    let f = min(1, max(0, (value.location.x - Theme.Metrics.pt19) / travel))
                    let i = min(count - 1, max(0, Int((f * CGFloat(count - 1)).rounded())))
                    if levels.indices.contains(i), levels[i] != composer.effort { composer.setEffort(levels[i]) }
                }.onEnded { _ in drag = false })
            }
            .frame(height: Theme.Metrics.pt38)
            .accessibilityElement().accessibilityLabel("Denktiefe").accessibilityValue(ModelInfo.effortLabels[composer.effort ?? ""] ?? "")
            .accessibilityAdjustableAction { direction in
                let next = min(count - 1, max(0, index + (direction == .increment ? 1 : -1)))
                if levels.indices.contains(next) { composer.setEffort(levels[next]) }
            }
            HStack(spacing: Theme.Metrics.pt0) {
                ForEach(Array(levels.enumerated()), id: \.offset) { i, level in
                    Text(ModelInfo.effortLabels[level] ?? level).font(Theme.Fonts.geist(Theme.Fonts.size12))
                        .foregroundStyle(i == index ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                        .goldText(i == index && isMax)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // Griff 34: weiß; auf der höchsten Stufe goldener Rand mit pulsierendem Glühen (effort-glow).
    @ViewBuilder private var thumb: some View {
        if isMax {
            TimelineView(.ambient(paused: reduceMotion)) { context in
                let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Theme.Gold.period) / Theme.Gold.period
                let glow = reduceMotion ? 0 : (1 - cos(t * 2 * .pi)) / 2
                Circle().fill(Theme.Palette.thumb).frame(width: Theme.Metrics.pt34, height: Theme.Metrics.pt34)
                    .overlay(Circle().strokeBorder(Theme.Gold.thumb, lineWidth: Theme.Metrics.pt2))
                    .shadow(color: Theme.Gold.thumb.opacity(0.45 + 0.15 * glow), radius: Theme.Metrics.pt6 + Theme.Metrics.pt6 * glow)
            }
        } else {
            Circle().fill(Theme.Palette.thumb).frame(width: Theme.Metrics.pt34, height: Theme.Metrics.pt34).shadow(color: Theme.Palette.shadow.opacity(0.2), radius: Theme.Metrics.pt3, y: Theme.Metrics.pt2)
        }
    }

    private struct OptionRow: View {
        let title: String
        let active: Bool
        let jev: Bool
        let note: String?
        let action: () -> Void
        @State private var hover = false

        var body: some View {
            Button(action: action) {
                HStack(spacing: Theme.Metrics.pt10) {
                    if jev { Image(systemName: "sparkles").font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.primary).jevPulse() }
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                        Text(title).font(Theme.Fonts.geist(Theme.Fonts.size12)).lineLimit(1)
                        if let note { Text(note).font(Theme.Fonts.geist(Theme.Fonts.size11)).foregroundStyle(Theme.Palette.mutedForeground) }
                    }
                    Spacer(minLength: Theme.Metrics.pt0)
                    if active { Image(systemName: "checkmark").font(.system(size: Theme.Metrics.pt11, weight: .semibold)).foregroundStyle(Theme.Palette.primary) }
                }
                // Figma 26:11564: Zeilen 24, Schrift 12, innen 8, Hover secondaryHover.
                .padding(.horizontal, Theme.Metrics.pt8).frame(minHeight: Theme.Metrics.pt24)
                .background(active ? Theme.Palette.muted : (hover ? Theme.Palette.secondaryHover : .clear), in: .rect(cornerRadius: Theme.Radius.lg))
                .jevSweep(jev)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
            .accessibilityAddTraits(active ? .isSelected : [])
        }
    }
}

// MARK: Slash-Menü (Web: SlashMenu): über dem Feld, 384 breit, höchstens 256 hoch, gruppiert nach Orbit und Brain.

struct SlashMenuView: View {
    @Bindable var composer: ComposerModel
    @Environment(\.staticRendering) private var staticRendering
    let draft: String
    let choose: (SlashSkill) -> Void
    let newSkill: () -> Void

    var body: some View {
        let filtered = composer.filteredSkills(for: draft)
        Group {
            if staticRendering { contents(filtered) }
            else { ScrollView { contents(filtered) } }
        }
        .frame(width: Theme.Metrics.pt384).frame(maxHeight: Theme.Metrics.pt256).fixedSize(horizontal: false, vertical: true)
        // Menü-Rahmen der Menü-Familie (Theme.Menu): Ecken, Linie, Farbe; Zeilen mit Beschreibung bleiben eigene Skill-Zeilen.
        .background(Theme.Palette.popover, in: .rect(cornerRadius: Theme.Menu.radius))
        .overlay(RoundedRectangle(cornerRadius: Theme.Menu.radius).strokeBorder(Theme.Palette.border, lineWidth: Theme.Menu.border))
        .foregroundStyle(Theme.Palette.popoverForeground)
        .accessibilityElement(children: .contain).accessibilityLabel("Skills")
    }

    private func contents(_ filtered: [SlashSkill]) -> some View {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                if !composer.skillsLoaded && composer.skillsError == nil {
                    // Figma 143:56735 „lädt“: 3 Platzhalter je 44 hoch, Balken 120 × 12 und volle Breite × 10, r6, muted, Abstand 6.
                    VStack(spacing: Theme.Metrics.pt0) {
                        ForEach(0..<3, id: \.self) { _ in
                            VStack(alignment: .leading, spacing: Theme.Metrics.pt6) {
                                RoundedRectangle(cornerRadius: Theme.Metrics.pt6).fill(Theme.Palette.muted).frame(width: Theme.Metrics.pt120, height: Theme.Metrics.pt12)
                                RoundedRectangle(cornerRadius: Theme.Metrics.pt6).fill(Theme.Palette.muted).frame(height: Theme.Metrics.pt10)
                            }
                            .padding(.horizontal, Theme.Metrics.pt8).frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt44, maxHeight: Theme.Metrics.pt44, alignment: .leading)
                        }
                    }.accessibilityElement(children: .ignore).accessibilityLabel("Skills werden geladen")
                }
                if let error = composer.skillsError { Text(error).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.destructive).padding(Theme.Metrics.pt12) }
                if composer.brainOffline {
                    // Figma 143:56735 „Brain offline“: Symbol 16, Titel 14 Medium, Zusatz 12 muted.
                    HStack(alignment: .top, spacing: Theme.Metrics.pt8) {
                        Image(systemName: "wifi.slash").font(.system(size: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground)
                        VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                            Text("Brain offline").font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Fonts.bodyLine)).foregroundStyle(Theme.Palette.foreground)
                            Text("Skills sind gerade nicht verfügbar. Befehle gehen weiter.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                        }
                    }
                    .padding(.horizontal, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt6)
                    .accessibilityElement(children: .combine)
                }
                if composer.skillsLoaded && filtered.isEmpty {
                    // Figma 143:56735 „leer“: Titel 14 Medium foreground, „Neuer Skill“ 13 Regular mit Plus 14.
                    Text("Kein Skill passt zu „\(SlashMenuLogic.query(in: draft) ?? "")“.").font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Fonts.bodyLine))
                        .foregroundStyle(Theme.Palette.foreground).padding(.horizontal, Theme.Metrics.pt8).padding(.top, Theme.Metrics.pt6)
                    Button(action: newSkill) {
                        HStack(spacing: Theme.Metrics.pt6) {
                            Image(systemName: "plus").font(.system(size: Theme.Metrics.pt14))
                            Text("Neuer Skill").font(Theme.Fonts.geist(Theme.Fonts.size13))
                        }
                    }
                    .buttonStyle(.plain).padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt32)
                }
                ForEach(["orbit", "brain"], id: \.self) { source in
                    let group = filtered.filter { $0.source == source }
                    if !group.isEmpty {
                        Text(source == "orbit" ? "Orbit" : "Brain").font(Theme.Fonts.smallMedium).foregroundStyle(Theme.Palette.mutedForeground)
                            .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt4)
                        ForEach(group) { skill in
                            let index = filtered.firstIndex(of: skill) ?? 0
                            row(skill, selected: index == min(composer.slashIndex, max(0, filtered.count - 1)))
                        }
                    }
                }
            }
            .padding(Theme.Metrics.pt6)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ skill: SlashSkill, selected: Bool) -> some View {
        Button { choose(skill) } label: {
            // Figma 143:56735: Zeile 14 Medium, Zeilenhöhe 20, gewählte Zeile muted.
            Text("/\(skill.name)").font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Fonts.bodyLine)).lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt32, alignment: .leading)
            .padding(.horizontal, Theme.Metrics.pt8)
            .background(selected ? Theme.Palette.muted : .clear, in: .rect(cornerRadius: Theme.Metrics.pt8))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: Anhänge im Entwurf (Web: Attachments inline: 32 hoch, r 8, Rand, Vorschau 20, Entfernen 20 beim Überfahren)

struct AttachmentChips: View {
    let attachments: [Attachment]
    let remove: (UUID) -> Void

    var body: some View {
        WebFlow(spacing: Theme.Metrics.pt8) {
            ForEach(attachments) { attachment in Chip(attachment: attachment, remove: { remove(attachment.id) }) }
        }
        .padding(.horizontal, Theme.Metrics.pt10).padding(.top, Theme.Metrics.pt6).padding(.bottom, Theme.Metrics.pt8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private struct Chip: View {
        let attachment: Attachment
        let remove: () -> Void
        @State private var hover = false

        var body: some View {
            HStack(spacing: Theme.Metrics.pt6) {
                preview
                Text(attachment.filename).font(Theme.Fonts.bodyMedium).lineLimit(1).truncationMode(.middle).frame(maxWidth: Theme.Metrics.pt220, alignment: .leading)
                Button(action: remove) { Image(systemName: "xmark").font(.system(size: Theme.Metrics.pt9, weight: .semibold)).frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20) }
                    .buttonStyle(.plain).opacity(hover ? 1 : 0).accessibilityLabel("Entfernen")
            }
            .foregroundStyle(hover ? Theme.Palette.accentForeground : Theme.Palette.mutedForeground)
            .padding(.horizontal, Theme.Metrics.pt6).frame(height: Theme.Metrics.pt32)
            .background(hover ? Theme.Palette.accent.opacity(0.5) : .clear, in: .rect(cornerRadius: Theme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt1))
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover)
            .accessibilityElement(children: .contain)
        }

        @ViewBuilder private var preview: some View {
            if let image = attachment.thumbnail {
                Image(nsImage: image).resizable().scaledToFill().frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20).clipShape(.rect(cornerRadius: Theme.Metrics.pt4))
            } else {
                Image(systemName: attachment.mediaType == "application/pdf" ? "doc.richtext" : "doc.text").font(.system(size: Theme.Metrics.pt11))
                    .frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20).background(Theme.Palette.background, in: .rect(cornerRadius: Theme.Metrics.pt4))
            }
        }
    }
}

// Umbrechende Reihe (Web: flex-wrap).
struct WebFlow: Layout {
    var spacing: CGFloat = Theme.Metrics.pt8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { arrange(proposal.width ?? .infinity, subviews).size }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (index, origin) in arrange(bounds.width, subviews).origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = [], x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            origins.append(CGPoint(x: x, y: y)); x += size.width + spacing; rowHeight = max(rowHeight, size.height); maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}

// MARK: Hinweise über dem Feld

// Zeile über dem Composer (Web: text-xs, Fehler destructive, sonst muted).
struct ComposerNote: View {
    let text: String
    var error = false
    var action: (title: String, run: () -> Void)?

    var body: some View {
        HStack(spacing: Theme.Metrics.pt8) {
            Text(text).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Fonts.smallLine))
                .foregroundStyle(error ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
            if let action { Button(action.title, action: action.run).buttonStyle(CardButtonStyle(variant: .ghost, size: .xs)) }
            Spacer(minLength: Theme.Metrics.pt0)
        }
        .padding(.horizontal, Theme.Metrics.pt4).padding(.bottom, Theme.Metrics.pt6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(error ? [.isStaticText] : [])
    }
}
