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
    @ReduceMotion private var reduceMotion
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
            Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt9, weight: Theme.Icon.weight)).opacity(0.6)
                .rotationEffect(.degrees(open ? 180 : 0))
        }
        .foregroundStyle(lit ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
        .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt32)
        .background(lit ? Theme.Palette.muted : .clear, in: .rect(cornerRadius: Theme.Radius.lg))
        .contentShape(.rect(cornerRadius: Theme.Radius.lg))
        .onHover { hover = $0 }
        .animation(reduceMotion ? nil : Theme.Motion.hover.animation, value: lit)
    }
}

// MARK: Modellwahl (Untermenü des Plus-Menüs, neu 16.11.2026)
// Wie ein macOS-Menü: Haken links, Modellname, Anbieter als kleine Überschrift statt Symbol in jeder Zeile, kein
// sichtbarer Scrollbalken. Oben „Auto“ mit Beschreibung, unten die Denktiefe als gleitende Reiter (nur bei mehreren Stufen).
struct ModelPanel: View {
    @Bindable var composer: ComposerModel
    // Schließt das Untermenü (Pfeil links, Esc bleibt beim ganzen Menü).
    var close: (() -> Void)?
    @State private var highlight = MenuHighlight()
    @FocusState private var focused: Bool

    // Reihenfolge für Pfeiltasten: Auto, dann die Modelle nach Anbieter.
    private var keys: [String] {
        [ModelInfo.autoId] + ModelInfo.providerOrder.flatMap { provider in composer.models.filter { $0.provider == provider }.map(\.id) }
    }

    private func move(_ step: Int) {
        let ids = keys
        guard !ids.isEmpty else { return }
        let index = (highlight.id?.base as? String).flatMap { ids.firstIndex(of: $0) } ?? (step > 0 ? -1 : ids.count)
        highlight.id = AnyHashable(ids[(index + step + ids.count) % ids.count])
    }

    private var levels: [String] { composer.isAuto ? [] : (composer.selectedModel?.efforts ?? []) }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    row(key: ModelInfo.autoId, title: "Auto", subtitle: "Jev wählt passend", active: composer.isAuto)
                    ForEach(ModelInfo.providerOrder, id: \.self) { provider in
                        let items = composer.models.filter { $0.provider == provider }
                        if !items.isEmpty {
                            header(provider)
                            ForEach(items) { model in
                                row(key: model.id, title: model.label, active: !composer.isAuto && model.id == composer.modelId)
                            }
                        }
                    }
                    if composer.models.isEmpty {
                        Text(emptyReason).font(Theme.Menu.subtitle).foregroundStyle(Theme.Palette.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, Theme.Menu.rowPaddingH).padding(.vertical, Theme.Metrics.pt6)
                    }
                }
                .menuHighlightScope(highlight)
            }
            .scrollIndicators(.never)
            .frame(maxHeight: Theme.Menu.listMaxHeight).fixedSize(horizontal: false, vertical: true)
            effort
        }
        // Tastatur (Sol 16.11.2026): beim Öffnen Fokus, ↑/↓ wählt die Zeile, ↩ übernimmt, ← schließt das Untermenü.
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear { focused = true }
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
        .onKeyPress(.leftArrow) { close?(); return .handled }
        .onKeyPress(.return) {
            guard let key = highlight.id?.base as? String else { return .ignored }
            composer.select(model: key); return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Modellwahl")
    }

    private func row(key: String, title: String, subtitle: String? = nil, active: Bool) -> some View {
        MenuRowButton(item: WebMenuItem(title: title, subtitle: subtitle, checked: active) { composer.select(model: key) }, key: key)
    }

    // Anbieter als leise Überschrift, Text bündig mit den Modellnamen.
    private func header(_ provider: String) -> some View {
        HStack(spacing: Theme.Menu.gap) {
            ProviderIcon(provider: provider, size: Theme.Menu.checkSize).foregroundStyle(Theme.Palette.mutedForeground)
                .frame(width: Theme.Menu.iconFrame)
            Text(ModelInfo.providerNames[provider] ?? provider).font(Theme.Menu.section).foregroundStyle(Theme.Palette.mutedForeground)
        }
        .padding(.horizontal, Theme.Menu.rowPaddingH).padding(.top, Theme.Metrics.pt8).padding(.bottom, Theme.Metrics.pt2)
        .accessibilityAddTraits(.isHeader)
    }

    // Denktiefe: nur bei Modellen mit mehreren Stufen.
    @ViewBuilder private var effort: some View {
        if levels.count > 1 {
            MenuSeparator()
            HStack(spacing: Theme.Menu.gap) {
                Text("Denktiefe").font(Theme.Menu.section).foregroundStyle(Theme.Palette.mutedForeground)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Theme.Metrics.pt0)
            }
            .padding(.horizontal, Theme.Menu.rowPaddingH).padding(.top, Theme.Metrics.pt2).padding(.bottom, Theme.Metrics.pt4)
            SlidingTabs(items: levels, selection: Binding(get: { ModelInfo.effortSelection(composer.effort, levels: levels, fallback: composer.selectedModel?.defaultEffort) }, set: { composer.setEffort($0) })) {
                ModelInfo.effortLabels[$0] ?? $0
            }
            .padding(.horizontal, Theme.Metrics.pt2).padding(.bottom, Theme.Metrics.pt2)
            .accessibilityElement(children: .contain).accessibilityLabel("Denktiefe")
        }
    }

    private var emptyReason: String {
        if case .failed(let text) = composer.catalog { return "Modelle konnten nicht geladen werden: \(text)" }
        return composer.modelsAvailable ? "Keine Modelle gemeldet." : "Keine Modelle verfügbar: Claude, Codex oder Gemini sind nicht angemeldet (siehe Einrichtung)."
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
        .overlay(RoundedRectangle(cornerRadius: Theme.Menu.radius).strokeBorder(Theme.Palette.menuBorder, lineWidth: Theme.Menu.border))
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
                        Image(systemName: "wifi.slash").font(.system(size: Theme.Metrics.pt16, weight: Theme.Icon.weight)).foregroundStyle(Theme.Palette.mutedForeground)
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
                            Image(systemName: "plus").font(.system(size: Theme.Metrics.pt14, weight: Theme.Icon.weight))
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
                Button(action: remove) { Image(systemName: "xmark").font(.system(size: Theme.Metrics.pt9, weight: Theme.Icon.weight)).frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20) }
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
                Image(systemName: attachment.mediaType == "application/pdf" ? "doc.richtext" : "doc.text").font(.system(size: Theme.Metrics.pt11, weight: Theme.Icon.weight))
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
