import SwiftUI

// Composer komplett (4c): Eingabe, Slash-Menü mit Skill-Chip, Anhänge (Büroklammer, Ablegen, Cmd+V), Freigabemodus, Kontext, Modell mit
// Stufe, Senden/Stopp. Enter sendet, Shift+Enter bricht um, Esc schließt das Slash-Menü, sonst stoppt es den Lauf; während eines
// Laufs ist das Feld gesperrt (auch in Gruppen und wenn ein anderer Auslöser im Chat arbeitet). Gruppenchat: @Name im Text.
struct ComposerView: View {
    @Environment(\.staticRendering) private var staticRendering
    @Bindable var session: ChatSession
    var members: [Bot] = []
    // Name des einzigen Orbis im 1:1-Chat (für den Platzhalter „Nachricht an …“).
    var directName: String?
    var locked = false
    @FocusState private var focused: Bool
    @Environment(\.screenAction) private var screenAction
    @State private var pasteMonitor: Any?
    @State private var slashHeight: CGFloat = Theme.Metrics.pt0
    @State private var mentionHeight: CGFloat = Theme.Metrics.pt0
    @State private var mentionIndex = 0
    // Entwurf, bei dem die @-Auswahl mit Esc geschlossen wurde (öffnet erst bei neuer Eingabe wieder).
    @State private var mentionDismissed: String?
    @Environment(\.mentionDirectory) private var directory
    @Environment(\.escapeStopsTurn) private var escapeStopsTurn

    private var busy: Bool { session.isRunning || session.retrying || locked }
    private var composer: ComposerModel { session.composer }
    private var slashOpen: Bool { SlashMenuLogic.query(in: session.draft) != nil && composer.skill == nil && !busy }
    // @-Auswahl: offene Markierung am Ende des Entwurfs, gefiltert beim Tippen.
    private var mentionItems: [MentionTarget]? {
        guard !busy, composer.skill == nil, let directory, session.draft != mentionDismissed,
              let query = Mentions.activeQuery(in: session.draft) else { return nil }
        return Mentions.filter(directory.targets, query: query)
    }
    private var mentionOpen: Bool { mentionItems != nil }
    // Stopp zeigt sich auch, wenn im Root-Chat nur noch andere Orbis des Auftrags arbeiten.
    private var stoppable: Bool { session.isRunning || locked || session.hasActiveLines }
    private var sendable: Bool {
        !busy && composer.canSend && (!session.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !composer.attachments.isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            // Hinweise stehen über dem durchlaufenden Verlauf: mit weichem Verlauf dahinter lesbar.
            VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                if case .failed(let text) = composer.catalog {
                    // Figma 26:11819: wifi-off 12, „Keine Verbindung“ 11 Regular muted, Lücke 6 (ohne Warteschlange); Dienst-Text als Hilfe.
                    HStack(spacing: Theme.Metrics.pt6) {
                        Image(systemName: "wifi.slash").font(.system(size: Theme.Metrics.pt12))
                        Text("Keine Verbindung").font(Theme.Fonts.caption)
                        Button("Erneut laden") { Task { await composer.loadCatalog() } }.buttonStyle(CardButtonStyle(variant: .ghost, size: .xs))
                        Spacer(minLength: Theme.Metrics.pt0)
                    }
                    .foregroundStyle(Theme.Palette.mutedForeground)
                    .padding(.horizontal, Theme.Metrics.pt4).padding(.bottom, Theme.Metrics.pt6)
                    .help("Der Dienst ist nicht erreichbar: \(text)")
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Keine Verbindung. Der Dienst ist nicht erreichbar: \(text)")
                } else if composer.catalog == .loaded && !composer.modelsAvailable {
                    ComposerNote(text: "Kein Modell angemeldet: Melde Claude, Codex oder Gemini an (Einstellungen › Allgemein), sonst können die Orbis nicht antworten.", error: true)
                }
                if let text = composer.attachError { ComposerNote(text: text, error: true) }
                if let text = session.notice { ComposerNote(text: text, action: ("Schließen", { session.clearNotice() })) }
            }
            .barFade()
            // Figma 26:11821: gesperrt = gesamte Leiste 40 %.
            // Die Fläche bleibt deckend, auch gesperrt: sonst schiene der Verlauf durch das Feld.
            box.opacity(locked ? Theme.Opacity.disabled : 1)
                .background(Theme.Palette.field, in: .rect(cornerRadius: boxRadius))
        }
        .padding(.top, Theme.Metrics.pt12).padding(.bottom, Theme.Layout.composerBottom)
        .task { if !staticRendering { await composer.loadCatalog() } }
        .task(id: slashOpen) { if slashOpen && !staticRendering { await composer.loadSkills() } }
        .onAppear { focused = true; installPasteMonitor() }
        .onDisappear { if let pasteMonitor { NSEvent.removeMonitor(pasteMonitor) }; pasteMonitor = nil }
        // Fehler eines Brain-Skills gilt der Eingabe, mit der er gewählt wurde: Weitertippen räumt ihn weg.
        .onChange(of: session.draft) { composer.slashIndex = 0; mentionIndex = 0; composer.skillError = nil }
        // Gesperrt verliert das Feld den Fokus: nach dem Turn kommt er zurück, sofern kein anderes Feld (Suche, Umbenennen) ihn hat.
        .onChange(of: busy) { if !busy, !(NSApp.keyWindow?.firstResponder is NSText) { focused = true } }
        // „Antworten“ an einer Blase: gleich weiterschreiben.
        .onChange(of: session.replyTarget?.id) { if session.replyTarget != nil, !busy { focused = true } }
    }

    // Mehrzeilig (Figma 15): Text oben, darunter eine Zeile mit Plus links und Senden rechts. Einzeilig bleibt alles in einer Reihe.
    private var multiline: Bool { session.draft.contains("\n") || session.draft.count > 70 }
    private var compact: Bool { !multiline && composer.attachments.isEmpty && session.replyTarget == nil }
    private var filled: Bool { !session.draft.isEmpty || !composer.attachments.isEmpty }
    // Figma 26:11812: mehrzeilig r20, sonst r24 (mit Anhängen r24).
    private var boxRadius: CGFloat { multiline && composer.attachments.isEmpty ? Theme.Metrics.pt20 : Theme.Radius.pill }
    // Name im Platzhalter: der einzige Orbi, in Gruppen der gewählte oder erwähnte.
    private var placeholderName: String? {
        if members.count > 1 {
            let mentioned = GroupText.mentionTarget(in: session.draft, members: members.map { GroupText.Member(id: $0.id, name: $0.name) })
            return mentioned.flatMap { id in members.first { $0.id == id }?.name }
        }
        return members.first?.name ?? directName
    }

    // Eingabeleiste (Figma „Chat Eingabeleiste“): Pille r24, Fläche field, Rand border 0,5; Plus links, Senden/Stopp rechts. Das Textfeld
    // bleibt immer dieselbe Ansicht (der Fokus geht beim Umbruch nicht verloren), nur Plus und Senden wandern.
    private var box: some View {
        VStack(spacing: Theme.Metrics.pt0) {
            if let target = session.replyTarget { replyPill(target) }
            if !composer.attachments.isEmpty { AttachmentChips(attachments: composer.attachments, remove: { composer.removeAttachment($0) }) }
            editor
                .padding(.horizontal, multiline ? Theme.Metrics.pt10 : Theme.Layout.composerTextInset)
                .padding(.bottom, multiline ? Theme.Metrics.pt40 : Theme.Metrics.pt0)
        }
        .overlay(alignment: compact ? .leading : .bottomLeading) { plusMenu.padding(.leading, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt8) }
        .overlay(alignment: compact ? .trailing : .bottomTrailing) { sendButton.padding(.trailing, Theme.Metrics.pt8).padding(.vertical, Theme.Metrics.pt8) }
        .background(Theme.Palette.field, in: .rect(cornerRadius: boxRadius))
        // Figma 26:11822: Rand border bei leer/läuft/offline/deaktiviert, input sobald getippt oder Anhänge da sind.
        .overlay(RoundedRectangle(cornerRadius: boxRadius).strokeBorder(Theme.Palette.fieldBorder, lineWidth: Theme.Metrics.pt0_5))
        .animation(Theme.Motion.hover.animation, value: multiline)
        .overlay(alignment: .topLeading) {
            if slashOpen {
                SlashMenuView(composer: composer, draft: session.draft, choose: { pick($0) }, newSkill: createSkill)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { slashHeight = $0 }
                    .offset(y: -slashHeight - Theme.Metrics.pt8)
                    .opacity(slashHeight == 0 ? 0 : 1)
            }
        }
        .overlay(alignment: .topLeading) {
            if let items = mentionItems {
                MentionMenuView(items: items, bots: directory?.bots ?? [], selected: min(mentionIndex, max(0, items.count - 1)), choose: { pickMention($0) })
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { mentionHeight = $0 }
                    .offset(y: -mentionHeight - Theme.Metrics.pt8)
                    .opacity(mentionHeight == 0 ? 0 : 1)
            }
        }
        // Web: Skill-Chip und Fehlerzeile schweben über dem Feld (absolute bottom-full left-2 mb-2), nicht darin.
        .overlay(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt4) {
                if let skill = composer.skill { skillChip(skill) }
                if let text = composer.skillError { Text(text).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true) }
            }
            .padding(.leading, Theme.Metrics.pt8)
            .alignmentGuide(.top) { $0[.bottom] + Theme.Metrics.pt8 }
        }
        .probe("composer")
    }

    private func replyPill(_ target: ChatMessage) -> some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text(target.text).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: Theme.Metrics.pt0)
            Button { session.replyTarget = nil } label: {
                Image(systemName: "xmark")
                    .font(.system(size: Theme.Metrics.pt9, weight: .semibold))
                    .foregroundStyle(Theme.Palette.mutedForeground)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Zitat entfernen")
        }
        .font(Theme.Fonts.small)
        .foregroundStyle(Theme.Palette.mutedForeground)
        .padding(.horizontal, Theme.Metrics.pt10)
        .padding(.vertical, Theme.Metrics.pt6)
        .background(Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Radius.md))
        .padding(.horizontal, Theme.Metrics.pt12)
        .padding(.top, Theme.Metrics.pt10)
        .padding(.bottom, Theme.Metrics.pt2)
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $session.draft)
                .font(Theme.Fonts.message)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .disabled(busy)
                .frame(minHeight: Theme.Metrics.pt24, maxHeight: Theme.Metrics.pt140)
                .fixedSize(horizontal: false, vertical: true)
                // Grok Bot: Leiste 44 hoch (Zeile 24 + 2 × 10).
                .padding(.horizontal, Theme.Metrics.pt5).padding(.vertical, Theme.Metrics.pt10)
                .onKeyPress(.downArrow, phases: .down) { _ in moveMention(1) == .handled ? .handled : moveSlash(1) }
                .onKeyPress(.upArrow, phases: .down) { _ in moveMention(-1) == .handled ? .handled : moveSlash(-1) }
                .onKeyPress(.return, phases: .down) { press in
                    if let items = mentionItems {
                        if !items.isEmpty { pickMention(items[min(mentionIndex, items.count - 1)]) }
                        return .handled
                    }
                    if slashOpen {
                        let list = composer.filteredSkills(for: session.draft)
                        if !list.isEmpty { pick(list[min(composer.slashIndex, list.count - 1)]) }
                        else if composer.skillsLoaded { createSkill() }
                        return .handled
                    }
                    guard !press.modifiers.contains(.shift) else { return .ignored }
                    guard !busy else { return .handled }
                    submit()
                    return .handled
                }
                .onKeyPress(.escape, phases: .down) { _ in
                    if mentionOpen { mentionDismissed = session.draft; return .handled }
                    if slashOpen { session.draft = ""; return .handled }
                    if !session.isRunning, session.replyTarget != nil { session.replyTarget = nil; return .handled }
                    guard session.isRunning else { return .ignored }
                    session.stop()
                    return .handled
                }
            if session.draft.isEmpty {
                Text(placeholderName.map { "Nachricht an \($0)" } ?? "Nachricht")
                    .font(Theme.Fonts.message)
                    .foregroundStyle(Theme.Palette.mutedForeground)
                    .padding(.horizontal, Theme.Metrics.pt10).padding(.vertical, Theme.Metrics.pt10)
                    .allowsHitTesting(false)
            }
        }
        .padding(.horizontal, Theme.Metrics.pt5)
    }

    // Plus-Menü (Figma 15): „Anhang hinzufügen“, Verlauf mitsenden, darunter die Modellwahl.
    private var plusMenu: some View {
        WebMenuButton(alignment: .leading, above: true, screenName: screenAction == "modell-liste" ? "modell-liste" : "modell",
                      custom: { AnyView(ComposerPlusPanel(composer: composer, attach: openFiles)) }, customWidth: Theme.Menu.wideWidth, items: { [] }) { open in
            // Grok Bot: Plus im gefüllten Kreis 28.
            Image(systemName: "plus").font(.system(size: Theme.Metrics.pt14, weight: .medium))
                .foregroundStyle(open ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                .frame(width: Theme.Layout.composerControl, height: Theme.Layout.composerControl)
                .background(Theme.Palette.secondaryHover, in: .circle)
                .contentShape(.circle)
        }
        .fixedSize()
        .accessibilityLabel("Anhang und Modell")
    }

    private func skillChip(_ skill: SlashSkill) -> some View {
        Button { composer.skill = nil } label: { Text("/\(skill.name) ×") }
            .buttonStyle(CardButtonStyle(variant: .secondary, size: .small))
            .accessibilityLabel("Skill \(skill.name) entfernen")
    }

    // MARK: Aktionen

    @Environment(\.openNewSkill) private var openNewSkill

    private func createSkill() {
        guard let openNewSkill, let name = SlashMenuLogic.query(in: session.draft) else { return }
        session.draft = ""
        openNewSkill(name)
    }

    private func submit() {
        // `/skill neu <name>` öffnet den Dialog „Neuer Skill“ und leert das Feld (Web: chat.tsx).
        if let name = SlashMenuLogic.newSkillName(in: session.draft) {
            session.draft = ""
            openNewSkill?(name)
            return
        }
        session.send(session.draft)
    }

    private func moveSlash(_ step: Int) -> KeyPress.Result {
        guard slashOpen else { return .ignored }
        let count = composer.filteredSkills(for: session.draft).count
        guard count > 0 else { return .handled }
        composer.slashIndex = min(count - 1, max(0, composer.slashIndex + step))
        return .handled
    }

    private func moveMention(_ step: Int) -> KeyPress.Result {
        guard let items = mentionItems else { return .ignored }
        guard !items.isEmpty else { return .handled }
        mentionIndex = min(items.count - 1, max(0, mentionIndex + step))
        return .handled
    }

    // Setzt „@Name “ ins Feld und merkt die Wahl: erst beim Senden wird daraus `@[Name](orbi:<id>)`.
    private func pickMention(_ target: MentionTarget) {
        session.draft = Mentions.complete(session.draft, with: target)
        if !session.pickedMentions.contains(target) { session.pickedMentions.append(target) }
        mentionDismissed = nil
        focused = true
    }

    private func pick(_ skill: SlashSkill) {
        Task {
            if await composer.choose(skill) { session.draft = ""; focused = true }
        }
    }

    private func openFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "Anhängen"
        panel.begin { response in
            guard response == .OK else { return }
            Task { @MainActor in composer.add(urls: panel.urls) }
        }
    }

    // Cmd+V: Dateien, Bilder und PDF aus der Zwischenablage werden Anhänge; reiner Text geht ungestört ins Feld.
    private func installPasteMonitor() {
        guard pasteMonitor == nil else { return }
        let composer = composer
        pasteMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, event.charactersIgnoringModifiers == "v",
                  // Nur das Eingabefeld; Suche und Umbenennen (Feld-Editor) fügen normal ein.
                  let field = NSApp.keyWindow?.firstResponder as? NSTextView, !field.isFieldEditor else { return event }
            let handled = MainActor.assumeIsolated { Self.paste(into: composer) }
            return handled ? nil : event
        }
    }

    @MainActor static func paste(into composer: ComposerModel, from board: NSPasteboard = .general) -> Bool {
        if let urls = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            composer.add(urls: urls); return true
        }
        guard board.string(forType: .string) == nil else { return false }
        if let data = board.data(forType: .pdf) ?? board.data(forType: NSPasteboard.PasteboardType("com.adobe.pdf")) {
            composer.add(data: data, filename: "einfügung.pdf", mediaType: "application/pdf"); return true
        }
        if let data = board.data(forType: .png) ?? board.data(forType: .tiff), let image = NSImage(data: data),
           let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            composer.add(data: png, filename: "einfügung.png", mediaType: "image/png"); return true
        }
        return false
    }

    // Senden (Pfeil nach oben) oder, solange ein Turn läuft, Stopp; runder Knopf in der Akzentfarbe des Orbis (Figma 15).
    @ViewBuilder private var sendButton: some View {
        if stoppable {
            // Figma: Stopp = Quadrat 8 × 8, r2, im Kreis 24.
            Button { session.stop() } label: { RoundedRectangle(cornerRadius: Theme.Metrics.pt2).frame(width: Theme.Metrics.pt8, height: Theme.Metrics.pt8) }
                .buttonStyle(ComposerSendStyle(active: true))
                // Esc stoppt im ganzen Fenster, auch wenn das Eingabefeld gesperrt (ohne Fokus) ist; nicht, solange Esc etwas darüber schließt.
                .keyboardShortcut(escapeStopsTurn ? KeyboardShortcut(.escape, modifiers: []) : nil)
                .accessibilityLabel("Antwort stoppen")
        } else {
            // Bei leerem Feld grau; gesendet wird dann nichts.
            Button { if sendable { submit() } } label: { Image(systemName: "arrow.up").font(.system(size: Theme.Metrics.pt14, weight: .semibold)) }
                .buttonStyle(ComposerSendStyle(active: sendable))
                .disabled(busy || !composer.canSend)
                .accessibilityLabel("Nachricht senden")
        }
    }


}


// Sendeknopf: Kreis 24, Akzentfarbe des Orbis; ohne Text grau (Figma „Chat Eingabeleiste“).
private struct ComposerSendStyle: ButtonStyle {
    var active: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(active ? Theme.Palette.primaryForeground : Theme.Palette.mutedForeground)
            .frame(width: Theme.Layout.composerControl, height: Theme.Layout.composerControl)
            .background(active ? Theme.Palette.primary : Theme.Palette.secondaryHover, in: .circle)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .contentShape(.circle)
            .probe("composer-send")
    }
}

// Inhalt des Plus-Menüs: Anhang, Verlauf mitsenden, Modellwahl.
private struct ComposerPlusPanel: View {
    @Bindable var composer: ComposerModel
    let attach: () -> Void
    @Environment(\.overlay) private var overlay

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            row("paperclip", "Anhang hinzufügen") { overlay?.menu = nil; attach() }
            row("clock.arrow.circlepath", composer.context ? "Verlauf wird mitgesendet" : "Nur die neue Nachricht", checked: composer.context) { composer.context.toggle() }
            MenuSeparator()
            ModelPanel(composer: composer)
        }
    }

    private func row(_ icon: String, _ title: String, checked: Bool = false, action: @escaping () -> Void) -> some View {
        PlusRow(icon: icon, title: title, checked: checked, action: action)
    }

    private struct PlusRow: View {
        let icon: String
        let title: String
        let checked: Bool
        let action: () -> Void
        @State private var hover = false

        var body: some View {
            Button(action: action) { MenuRowLabel(item: WebMenuItem(title: title, icon: icon, checked: checked) {}, lit: hover) }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
        }
    }
}

extension EnvironmentValues {
    // Fenster ohne offenen Dialog, Bildbetrachter, Menü oder Suchergebnis (MainWindow): dann stoppt Esc den laufenden Turn.
    @Entry var escapeStopsTurn = true
}
