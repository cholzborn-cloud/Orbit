import SwiftUI

// Formular Routine nach Figma 140:43986: Karte 400 (card, r16, Ring 0,5, innen 16, Abstand 16), „Neue Routine“, gruppierte Zeilen
// Name / Wiederholung / Tag / Uhrzeit, Aufgabe-Feld 72, Fuß mit Pillen. Die übrigen Felder stehen hinter „Mehr“.
struct AutomationFormView: View {
    let model: AppModel
    @Bindable var form: AutomationFormModel
    let onClose: () -> Void
    @FocusState private var nameFocused: Bool
    @State private var overlay = OverlayCenter()
    @State private var moreOpen = false
    @Environment(\.screenAction) private var screenAction
    @State private var contentHeight: CGFloat = Theme.Metrics.pt280

    private var store: AutomationStore { model.automations }
    private var orbis: [Bot] { model.botStore.orbis.sorted { ($0.isMain ? 0 : 1, $0.name) < ($1.isMain ? 0 : 1, $1.name) } }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            HStack(spacing: Theme.Metrics.pt8) {
                Text(form.editing == nil ? "Neue Routine" : "Routine bearbeiten").font(Theme.Fonts.geist(Theme.Fonts.size16, .medium)).lineHeight(.exact(points: Theme.Metrics.pt20))
                Spacer(minLength: Theme.Metrics.pt0)
                Button(action: onClose) { Image(systemName: "xmark").font(.system(size: Theme.Metrics.pt11, weight: .medium)).foregroundStyle(Theme.Palette.mutedForeground) }
                    .buttonStyle(.plain).accessibilityLabel("Schließen")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
                    fields
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt6) {
                        Text("Aufgabe").font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground)
                        RoutineTextArea(text: $form.prompt, placeholder: "Was soll der Orbi tun?")
                    }
                    moreSection
                    if let error = form.error { InlineAlert(text: error) }
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollIndicators(.never)
            .frame(height: min(contentHeight, Theme.Metrics.pt460))
            HStack(spacing: Theme.Metrics.pt8) {
                Spacer(minLength: Theme.Metrics.pt0)
                Button("Abbrechen", action: onClose).buttonStyle(.card(.outline)).keyboardShortcut(.cancelAction)
                Button(form.saving ? "Speichert …" : form.editing == nil ? "Anlegen" : "Speichern") { Task { await save() } }
                    .buttonStyle(.card(.primary)).keyboardShortcut(.defaultAction).disabled(form.saving)
            }
        }
        .padding(Theme.Metrics.pt16)
        .frame(width: Theme.Metrics.pt400)
        .background(Theme.Palette.card)
        .clipShape(.rect(cornerRadius: Theme.Metrics.pt16))
        .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.pt16).strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))
        .foregroundStyle(Theme.Palette.popoverForeground)
        .font(Theme.Fonts.body)
        // Menüs brauchen ein eigenes Overlay im Sheet-Fenster.
        .overlay { OverlayLayer(center: overlay) }
        .coordinateSpace(name: "orbit-window")
        // Screenshot-Szene: die Orbi-Wahl liegt unter „Mehr“.
        .onAppear { if screenAction == "menu-routine-orbi" { moreOpen = true } }
        .environment(\.overlay, overlay)
        .task { await form.loadModels(client: model.client) }
        .onAppear { nameFocused = true }
    }

    // Gruppierte Zeilen (Figma 143:53392): card, r10, Rand 0,5, Trenner 0,5; Zeile 40, innen 10/12, Name 14 foreground, Wert 14 muted.
    private var fields: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            fieldRow("Name") {
                TextField("z. B. Morgenbriefing", text: $form.name, prompt: Text("z. B. Morgenbriefing").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).multilineTextAlignment(.trailing)
                    .foregroundStyle(Theme.Palette.mutedForeground).focused($nameFocused).accessibilityLabel("Name")
            }
            rowDivider
            fieldRow("Wiederholung") {
                chooser(value: form.kind.title, options: ScheduleKind.allCases.map { ($0, $0.title) }, selection: $form.kind, label: "Wiederholung", screenName: "menu-routine-wiederholung")
            }
            if form.kind == .weekly {
                rowDivider
                fieldRow("Tag") {
                    chooser(value: Schedule.weekdayNames[min(max(form.weekday, 0), 6)], options: Schedule.weekdayNames.enumerated().map { ($0.offset, $0.element) }, selection: $form.weekday, label: "Wochentag")
                }
            }
            if form.kind == .monthly {
                rowDivider
                fieldRow("Tag") { TextField("1", text: $form.dayText, prompt: Text("1").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).multilineTextAlignment(.trailing).foregroundStyle(Theme.Palette.mutedForeground).accessibilityLabel("Monatstag") }
            }
            if form.kind == .once {
                rowDivider
                fieldRow("Tag") { TextField("TT.MM.JJJJ", text: $form.dateText, prompt: Text("TT.MM.JJJJ").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).multilineTextAlignment(.trailing).foregroundStyle(Theme.Palette.mutedForeground).accessibilityLabel("Datum") }
            }
            rowDivider
            fieldRow("Uhrzeit") {
                TextField("08:00", text: $form.at, prompt: Text("08:00").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).multilineTextAlignment(.trailing).foregroundStyle(Theme.Palette.mutedForeground).accessibilityLabel("Uhrzeit")
            }
        }
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .clipShape(.rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }

    private var rowDivider: some View { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }

    private func fieldRow<Value: View>(_ title: String, @ViewBuilder value: () -> Value) -> some View {
        HStack(spacing: Theme.Metrics.pt8) {
            Text(title).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20))
            Spacer(minLength: Theme.Metrics.pt8)
            value().font(Theme.Fonts.body)
        }
        .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt10).frame(minHeight: Theme.Metrics.pt40)
    }

    private func chooser<Value: Hashable>(value: String, options: [(Value, String)], selection: Binding<Value>, label: String, screenName: String? = nil) -> some View {
        WebMenuButton(alignment: .trailing, screenName: screenName, items: {
            options.map { option in WebMenuItem(title: option.1, checked: option.0 == selection.wrappedValue) { selection.wrappedValue = option.0 } }
        }) { _ in
            HStack(spacing: Theme.Metrics.pt8) {
                Text(value).foregroundStyle(Theme.Palette.mutedForeground)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: Theme.Metrics.pt10, weight: .medium)).foregroundStyle(Theme.Palette.mutedForeground)
            }
            .contentShape(.rect)
        }
        .accessibilityLabel(label)
    }

    // Alles, was Figma nicht zeigt, aber die Funktion braucht (Orbi, Ergebnis, Benachrichtigung, Modell, Vorschau).
    private var moreSection: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
            Button { moreOpen.toggle() } label: {
                HStack(spacing: Theme.Metrics.pt6) {
                    Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt12, weight: .medium)).rotationEffect(.degrees(moreOpen ? 0 : -90)).frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16)
                    Text("Mehr").font(Theme.Fonts.small)
                    Spacer(minLength: Theme.Metrics.pt0)
                }
                .foregroundStyle(Theme.Palette.mutedForeground).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(moreOpen ? "aufgeklappt" : "zugeklappt")
            if moreOpen {
                DialogField("Orbi") { orbiField }
                DialogField("Ergebnis erscheint") {
                    WebSelect(options: [("same", "Im Chat des Orbis"), ("new", "In einem neuen Chat pro Lauf")], selection: $form.target, fill: true, label: "Ergebnis erscheint")
                }
                notifyRow
                modelSection
                hint
            }
        }
    }

    private func save() async {
        form.error = nil
        form.saving = true
        defer { form.saving = false }
        if let message = await store.save(form.form(), editing: form.editing) { form.error = message } else { onClose() }
    }

    @ViewBuilder private var orbiField: some View {
        if let editing = form.editing {
            // Beim Bearbeiten steht der Orbi fest (Web: nur Anzeige).
            HStack(spacing: Theme.Metrics.pt8) {
                let bot = model.botStore.bot(id: editing.bot.id)
                OrbiAvatar(name: editing.bot.name, avatar: bot?.avatar ?? editing.bot.avatar, colorHex: bot?.color, look: bot?.look, size: Theme.Metrics.pt20)
                Text(editing.bot.name).font(Theme.Fonts.body).lineLimit(1)
                Spacer(minLength: Theme.Metrics.pt0)
            }
            .padding(.horizontal, Theme.Metrics.pt10).frame(height: Theme.Metrics.pt32)
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.input, lineWidth: Theme.Metrics.pt1))
        } else {
            WebMenuButton(matchWidth: true, screenName: "menu-routine-orbi", items: {
                orbis.map { bot in
                    WebMenuItem(title: bot.name, subtitle: nil, checked: bot.id == form.botId, leading: AnyView(OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt20))) { form.botId = bot.id }
                }
            }) { open in
                let bot = orbis.first { $0.id == form.botId }
                SelectTriggerLabel(title: bot?.name ?? "Orbi wählen", open: open, fill: true) {
                    if let bot { OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt20) }
                }
            }
            .accessibilityLabel("Orbi")
        }
    }

    // Benachrichtigung (Web: label mit Schalter default, Text 14 und 12 muted).
    private var notifyRow: some View {
        HStack(alignment: .center, spacing: Theme.Metrics.pt12) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                Text("Benachrichtigung").font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20))
                Text("Zeigt in der Seitenleiste, wenn ein Lauf fertig ist").font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16))
                    .foregroundStyle(Theme.Palette.mutedForeground)
            }
            Spacer(minLength: Theme.Metrics.pt0)
            Toggle("Benachrichtigung", isOn: $form.notify).toggleStyle(WebSwitchStyle()).labelsHidden()
        }
        .contentShape(.rect)
        .onTapGesture { form.notify.toggle() }
    }

    private var modelSection: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
            Button { form.modelsOpen.toggle() } label: {
                HStack(spacing: Theme.Metrics.pt6) {
                    Image(systemName: "chevron.down").font(.system(size: Theme.Metrics.pt12, weight: .medium)).rotationEffect(.degrees(form.modelsOpen ? 0 : -90)).frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16)
                    Text("Modell und Kontext").font(Theme.Fonts.body)
                    Spacer(minLength: Theme.Metrics.pt0)
                }
                .foregroundStyle(Theme.Palette.mutedForeground).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(form.modelsOpen ? "aufgeklappt" : "zugeklappt")
            if form.modelsOpen {
                let columns = [GridItem(.flexible(), spacing: Theme.Metrics.pt12, alignment: .top), GridItem(.flexible(), alignment: .top)]
                LazyVGrid(columns: columns, spacing: Theme.Metrics.pt12) {
                    DialogField("Modell") { modelPicker }
                    DialogField("Kontext") {
                        WebSelect(options: [(true, "Mit Verlauf"), (false, "Nur die Aufgabe")], selection: $form.context, fill: true, label: "Kontext")
                    }
                }
            }
        }
    }

    // Modell und Stufe: Auto (Jev) und verfügbare Modelle; die Stufe als zweite Auswahl, wenn das Modell mehrere kennt.
    private var modelPicker: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
            let options: [(value: String, title: String)] = [(ModelInfo.autoId, "Auto (Jev)")] + form.models.map { ($0.id, $0.label) }
            let known = options.contains { $0.value == form.modelId }
            WebSelect(options: known ? options : options + [(form.modelId, form.modelId)], selection: $form.modelId, fill: true, label: "Modell")
            if let model = form.selectedModel, model.efforts.count > 1 {
                WebSelect(options: model.efforts.map { ($0, ModelInfo.effortLabels[$0] ?? $0) },
                          selection: Binding(get: { form.effortNow ?? model.efforts[0] }, set: { form.effort = $0 }), small: true, label: "Stufe")
            }
        }
    }

    private var hint: some View {
        HStack(alignment: .top, spacing: Theme.Metrics.pt8) {
            Image(systemName: "clock.arrow.circlepath").font(.system(size: Theme.Metrics.pt12)).frame(width: Theme.Metrics.pt14, height: Theme.Metrics.pt14).padding(.top, Theme.Metrics.pt2)
            Text(form.upcomingText()).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16)).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(Theme.Palette.mutedForeground)
        .padding(Theme.Metrics.pt12)
        .background(Theme.Palette.muted.opacity(0.5), in: .rect(cornerRadius: Theme.Radius.lg))
    }
}

// Aufgabe-Feld (Figma 143:53413): card, Rand 0,5, r10, innen 10/12, 14/20, 72 hoch.
private struct RoutineTextArea: View {
    @Binding var text: String
    var placeholder: String

    var body: some View {
        TextEditor(text: $text)
            .font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).scrollContentBackground(.hidden)
            .padding(.horizontal, Theme.Metrics.pt7).padding(.vertical, Theme.Metrics.pt10)
            .frame(height: Theme.Metrics.pt72)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground)
                        .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt10).allowsHitTesting(false)
                }
            }
            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            .accessibilityLabel("Aufgabe")
    }
}
