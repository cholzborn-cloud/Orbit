import SwiftUI

// Rechtes Panel wie components/chat-side-panel.tsx / group-side-panel.tsx: die Kopf-Pille klappt es auf und zu (380 ms
// cubic-bezier(.32,.72,0,1)), Breite 380 (25 % … 520, Chat mindestens 40 %), am Griff ziehbar. Inhalt rechts verankert mit
// Mindestbreite 240: beim Gleiten bricht nichts um, er schiebt sich nur ein.
struct SidePanelContainer<Chat: View, Panel: View>: View {
    @Bindable var model: AppModel
    @ViewBuilder let chat: Chat
    @ViewBuilder let panel: Panel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // Nur Bildfolgen: Stand des Aufklappens 0…1 zu einer festen Zeit (unsichtbare Fenster animieren nicht).
    @Environment(\.panelProgress) private var frameProgress
    @State private var dragStart: CGFloat?
    // Zugeklappt wird das Panel nicht gebaut (es läge sonst mit Breite 0 bei jedem Chatwechsel im Layout); nach dem ersten Aufklappen bleibt es.
    @State private var built = false

    var body: some View {
        GeometryReader { box in
            let total = box.size.width
            let width = Self.clamp(model.panelWidth, total: total)
            HStack(spacing: Theme.Metrics.pt0) {
                chat.frame(maxWidth: .infinity, maxHeight: .infinity)
                handle(total: total)
                // Inhalt so breit wie das Panel gerade ist, aber mindestens 240 (Web: w-full min-w-60, rechts verankert).
                Group { if built || model.panelOpen { panel } }
                    .frame(minWidth: Theme.Metrics.pt240, maxWidth: .infinity, alignment: .topLeading)
                    .frame(width: model.panelOpen ? width * (frameProgress ?? 1) : 0, alignment: .topTrailing)
                    .clipped()
                    .allowsHitTesting(model.panelOpen)
                    .accessibilityHidden(!model.panelOpen)
                    .probe("side-panel")
            }
            // Immer die volle Höhe des Fensters, auch wenn ein Inhalt kleiner angefragt wird (sonst hängt der Chat mittig).
            .frame(width: box.size.width, height: box.size.height, alignment: .topLeading)
            .animation(reduceMotion || dragStart != nil ? nil : Theme.Motion.panel.animation, value: model.panelOpen)
            .environment(\.panelOpen, model.panelOpen)
        }
        .onChange(of: model.panelOpen, initial: true) { if model.panelOpen { built = true } }
    }

    // Web: minSize 25 %, maxSize 520 px, Chat minSize 40 %.
    static func clamp(_ w: CGFloat, total: CGFloat) -> CGFloat {
        max(total * 0.25, min(w, AppModel.panelMaxWidth, total * 0.6))
    }

    // Griff: 1-pt-Linie border, Zugfläche 4 pt (Web: ResizableHandle w-px, after:w-1).
    private func handle(total: CGFloat) -> some View {
        Rectangle().fill(Theme.Palette.border).frame(width: Theme.Metrics.pt0_5)   // Figma Rechtes Panel: Linie 0,5
            .overlay {
                Color.clear.frame(width: Theme.Metrics.pt5).contentShape(.rect)
                    .onHover { inside in if inside && model.panelOpen { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
                    .gesture(DragGesture(minimumDistance: Theme.Metrics.pt1, coordinateSpace: .global).onChanged { g in
                        guard model.panelOpen else { return }
                        let start = dragStart ?? Self.clamp(model.panelWidth, total: total)
                        dragStart = start
                        model.panelWidth = Self.clamp(start - g.translation.width, total: total)
                    }.onEnded { _ in dragStart = nil })
            }
    }
}

extension EnvironmentValues {
    @Entry var panelProgress: Double?
    @Entry var panelOpen = false
}

// Schließen-Knopf rechts neben den Reitern des Seitenpanels (wie die Pille im Kopf).
struct PanelCloseButton: View {
    let model: AppModel
    @State private var hover = false
    var body: some View {
        Button { model.togglePanel() } label: {
            // Figma Schließen (119:24163): 24 × 24, r6, xmark 10 muted.
            Image(systemName: "xmark").font(.system(size: Theme.Metrics.pt10, weight: .semibold))
                .foregroundStyle(hover ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
                .background(hover ? Theme.Palette.secondaryHover : .clear, in: .rect(cornerRadius: Theme.Radius.sm))
                .contentShape(.rect(cornerRadius: Theme.Radius.sm))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help("Seitenleiste schließen")
        .accessibilityLabel("Seitenleiste schließen")
    }
}

// Orbi-Seitenleiste nach Figma: Übersicht und Bearbeitung teilen denselben gespeicherten Orbi.
struct BotSidePanel: View {
    let model: AppModel
    let bot: Bot
    @State private var tab: String
    @State private var editor: BotEditorModel
    @State private var editing = false
    @State private var avatarHover = false
    @State private var routineForm: AutomationFormModel?
    @Environment(\.staticRendering) private var staticRendering

    init(model: AppModel, bot: Bot) {
        self.model = model
        self.bot = bot
        _tab = State(initialValue: ["desktop", "library"].contains(model.screenTab ?? "") ? model.screenTab! : "details")
        _editing = State(initialValue: ["edit", "look"].contains(model.screenTab ?? ""))
        _avatarHover = State(initialValue: model.screenTab == "hover")
        _editor = State(initialValue: BotEditorModel(editing: bot, others: model.botStore.orbis))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
                    identity
                    if editing {
                        editContent
                    } else {
                        PanelTabs(items: ["details", "library", "desktop"], selection: $tab) { $0 == "details" ? "Details" : $0 == "library" ? "Bibliothek" : "Computer" }
                        switch tab {
                        case "library": OrbiLibraryView(model: model, bot: bot)
                        case "memory": OrbiMemoryView(model: model, bot: bot)
                        case "desktop": computer
                        default: details
                        }
                    }
                }
                .padding(.horizontal, Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt24).padding(.bottom, Theme.Metrics.pt16)
            }
            .scrollIndicators(.never)
            .overlay(alignment: .topTrailing) { PanelCloseButton(model: model).padding(Theme.Metrics.pt8) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.Palette.background)
        .sheet(isPresented: Binding(get: { routineForm != nil }, set: { if !$0 { routineForm = nil } })) {
            if let routineForm { AutomationFormView(model: model, form: routineForm, onClose: { self.routineForm = nil }) }
        }
        .task { if !staticRendering { await model.automations.load() } }
    }

    private var identity: some View {
        VStack(spacing: Theme.Metrics.pt10) {   // Figma 119:24154: Orbi → Name 10, kein Untertitel (P2)
            Button { if !editing { beginEditing() } } label: {
                // Consti 05.11.: Augen folgen beim Darüberfahren und im ganzen Bearbeiten-Menü. Figur direkt mit eigenem Hover-Zustand
                // (OrbiAvatar nimmt für .panel nur Hover direkt über der Figur, das Stift-Overlay hat den verdeckt).
                OrbiFigure(
                    look: OrbiLook(
                        avatar: editing ? editor.shape.serviceName : bot.avatar,
                        colorHex: editing ? editor.look.bodyHex : bot.color,
                        look: editing ? editor.look.serviceLook : bot.look),
                    live: true, follow: true, hoverArea: editing || avatarHover, role: .panel)
                    .frame(width: Theme.Metrics.pt72, height: Theme.Metrics.pt72)
                    .overlay {
                        if avatarHover && !editing {
                            Rectangle().fill(Theme.Palette.background.opacity(0.64))
                            Image(systemName: "pencil").font(.system(size: Theme.Metrics.pt24)).foregroundStyle(Theme.Palette.foreground)
                        }
                    }
                    .clipShape(.rect(cornerRadius: Theme.Metrics.pt18))
            }
            .buttonStyle(.plain).onHover { avatarHover = $0 }
            .accessibilityLabel("\(bot.name) bearbeiten")
            if !editing {
                Text(bot.name).font(Theme.Fonts.geist(Theme.Fonts.size15, .medium))   // Figma 119:24154: 15 Medium
            }
        }
        .frame(maxWidth: .infinity)
    }

    // Figma Rechtes Panel (50:18183): Details zeigen nur Routinen (P8).
    private var details: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            Text("Routinen").font(Theme.Fonts.smallMedium)   // Figma 50:18182: 12 Medium (P11)
            if case .failed(let message, _) = model.automations.list { InlineAlert(text: message) }
            if let error = model.automations.error { InlineAlert(text: error) }
            // Figma Routinen-Zeile (50:18155): eine gemeinsame Box (card, r10, Rand 0,5, Trenner 0,5).
            let routines = model.automations.items.filter { $0.automation.botId == bot.id }
            if !routines.isEmpty {
                VStack(spacing: Theme.Metrics.pt0) {
                    ForEach(routines) { item in
                        PanelRoutineRow(item: item, edit: { routineForm = AutomationFormModel(editing: item, firstBotId: bot.id) },
                                        toggle: { Task { await model.automations.toggle(item, enabled: !item.automation.enabled) } },
                                        trash: { Task { await model.automations.moveToTrash(item) } })
                        if item.id != routines.last?.id { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
                    }
                }
                .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
                .clipShape(.rect(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
            }
            Button("+  Neue Routine") { routineForm = AutomationFormModel(editing: nil, firstBotId: bot.id) }
                .buttonStyle(.card(.outline)).environment(\.webButtonFill, true)
        }
    }

    // Computer-Reiter ohne Überschrift, Satz und „Sitzung“ (P16/K25).
    private var computer: some View {
        let session = model.desktops.session(for: bot)
        return VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            ComputerView(model: model, session: session)
            Button("Computer öffnen") { model.desktopFullscreen = bot.id }
                .buttonStyle(.card(.outline)).environment(\.webButtonFill, true)
        }
    }

    // Orbi-Menü nach Figma 119:24197: Reiter Form / Personalisieren; Speichern/Abbrechen bleiben, weil nichts sonst gesichert würde.
    private var editContent: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            HStack(spacing: Theme.Metrics.pt12) {
                Button { editing = false } label: { Image(systemName: "chevron.left") }
                    .buttonStyle(.plain).accessibilityLabel("Zurück")
                WebTabs(tabs: Array(BotEditorModel.Tab.allCases), selection: $editor.tab) { $0.rawValue }
            }
            ProfileTab(editor: editor, appearanceOnly: editor.tab == .profile, profileOnly: editor.tab == .look)
            if let error = editor.error { InlineAlert(text: error) }
            HStack(spacing: Theme.Metrics.pt8) {
                Button("Abbrechen") { editing = false }.buttonStyle(.card(.outline)).probe("orbi-edit-cancel")
                Button("Speichern") {
                    Task { await model.save(editor); if editor.error == nil { editing = false } }
                }.buttonStyle(.card(.primary)).disabled(editor.saving || editor.validationMessage != nil).probe("orbi-edit-save")
            }.environment(\.webButtonFill, true)
        }
    }

    private func beginEditing() {
        editor = BotEditorModel(editing: bot, others: model.botStore.orbis, tab: model.screenTab == "look" ? .look : .profile)
        editing = true
    }
}

// Reiter im Panel-Kopf (Figma 119:24155): Leiste 26, Reiter 22, 220 breit, gewählt segmentThumb Medium 12.
struct PanelTabs<Item: Hashable>: View {
    let items: [Item]
    @Binding var selection: Item
    let title: (Item) -> String

    var body: some View {
        HStack(spacing: Theme.Metrics.pt0) {
            ForEach(items, id: \.self) { item in
                Button { selection = item } label: {
                    Text(title(item))
                        .font(item == selection ? Theme.Fonts.smallMedium : Theme.Fonts.small).lineLimit(1).fixedSize(horizontal: true, vertical: false)
                        .frame(maxWidth: .infinity).frame(height: Theme.Metrics.pt22)
                        .foregroundStyle(item == selection ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                        .background(item == selection ? Theme.Palette.segmentThumb : .clear, in: .capsule)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain).accessibilityAddTraits(item == selection ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(Theme.Metrics.pt2).frame(width: Theme.Metrics.pt220).background(Theme.Palette.secondary, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5)).frame(maxWidth: .infinity).probe("panel-tabs")
    }
}

// Routinen-Zeile im Panel (Figma 50:18155): 36 hoch, innen 0/10, Abstand 8, Uhr 13 muted, Name 12, Zeitplan 11 muted, Hover
// secondaryHover mit ⋯ (24, r6, Symbol 14). Pausiert (50:19493): 50 % und „pausiert“ statt Zeitplan.
private struct PanelRoutineRow: View {
    let item: AutomationItem
    let edit: () -> Void
    let toggle: () -> Void
    let trash: () -> Void
    @State private var hover = false

    var body: some View {
        let paused = !item.automation.enabled
        HStack(spacing: Theme.Metrics.pt8) {
            Button(action: edit) {
                HStack(spacing: Theme.Metrics.pt8) {
                    Image(systemName: "clock").font(.system(size: Theme.Metrics.pt13)).foregroundStyle(Theme.Palette.mutedForeground)
                    Text(item.automation.name).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.foreground).lineLimit(1)
                    Text(paused ? "pausiert" : item.automation.schedule.summary).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                    Spacer(minLength: Theme.Metrics.pt0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .opacity(paused ? 0.5 : 1)
            WebMenuButton(alignment: .trailing, screenName: "menu-routine-zeile", items: {
                [WebMenuItem(title: "Bearbeiten", icon: "pencil", action: edit),
                 WebMenuItem(title: paused ? "Fortsetzen" : "Pausieren", icon: paused ? "play" : "pause", action: toggle),
                 WebMenuItem(title: "In den Papierkorb", icon: "trash", destructive: true, separatorBefore: true, action: trash)]
            }) { open in
                Image(systemName: "ellipsis").font(.system(size: Theme.Metrics.pt14))
                    .foregroundStyle(hover || open ? Theme.Palette.foreground : Theme.Palette.mutedForeground)
                    .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
                    .contentShape(.rect(cornerRadius: Theme.Radius.sm))
            }
            .opacity(hover ? 1 : 0)
            .accessibilityLabel("Aktionen für \(item.automation.name)")
        }
        .padding(.horizontal, Theme.Metrics.pt10).frame(height: Theme.Metrics.pt36)
        .background(hover ? Theme.Palette.secondaryHover : .clear)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: hover)
    }
}

struct LibraryFilterStyle: ButtonStyle {
    let selected: Bool
    @State private var hover = false

    func makeBody(configuration: Configuration) -> some View {
        // Figma Filter-Chip (50:18250): gewählt = graue Fläche + Medium, kein Haken.
        HStack(spacing: Theme.Spacing.xs) {
            configuration.label
        }
        .font(selected ? Theme.Fonts.smallMedium : Theme.Fonts.small)
        .foregroundStyle(Theme.Palette.foreground)
        .padding(.horizontal, Theme.Metrics.pt10)
        .frame(height: Theme.Metrics.pt24)
        .background(selected ? Theme.Palette.filterSelected : (hover || configuration.isPressed ? Theme.Palette.secondaryHover : .clear), in: .capsule)
        .overlay { Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
        .contentShape(.capsule)
        .onHover { hover = $0 }
    }
}

private struct OrbiLibraryResponse: Decodable {
    let files: [OrbiLibraryFile]
    let truncated: Bool
}

private struct OrbiLibraryFile: Decodable, Identifiable {
    let id: String
    let filename: String
    let mediaType: String
    let size: Int
    let kind: String
    let data: String?
}

private struct LibraryFileRow: View {
    let file: OrbiLibraryFile
    let downloading: Bool
    let disabled: Bool
    let download: () -> Void
    @State private var hover = false

    var body: some View {
        // Figma Datei-Zeile (50:18325): 40 hoch, innen 0/10, Abstand 10, Symbol 16, Name 12, darunter 11 muted, Abstand 1.
        HStack(spacing: Theme.Metrics.pt10) {
            Image(systemName: file.mediaType.hasPrefix("image/") ? "photo" : "doc.text")
                .foregroundStyle(Theme.Palette.mutedForeground).frame(width: Theme.Metrics.pt16)
            VStack(alignment: .leading, spacing: Theme.Metrics.pt1) {
                Text(file.filename).font(Theme.Fonts.small).lineLimit(1)
                Text("\(file.mediaType == "application/pdf" ? "PDF" : file.mediaType.hasPrefix("image/") ? "Bild" : "Text") · \(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file))")
                    .font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground)
            }
            Spacer(minLength: Theme.Metrics.pt0)
            if downloading { Spinner(size: Theme.Metrics.pt14) }
            else {
                // Figma 50:18325: Hover-Knöpfe 24, r6, Symbol 14.
                HStack(spacing: Theme.Metrics.pt0) {
                    Button(action: download) { Image(systemName: "arrow.down.to.line").font(.system(size: Theme.Metrics.pt14)) }
                        .buttonStyle(.web(.ghost, .iconXS)).accessibilityLabel("\(file.filename) sichern")
                    WebMenuButton(alignment: .trailing, items: { [WebMenuItem(title: "Datei sichern", icon: "arrow.down.to.line", action: download)] }) { _ in
                        Image(systemName: "ellipsis").font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.mutedForeground)
                            .frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24).contentShape(.rect(cornerRadius: Theme.Radius.sm))
                    }
                    .accessibilityLabel("Aktionen für \(file.filename)")
                }
                .opacity(hover ? 1 : 0)
            }
        }
        .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.foreground)
        .padding(.horizontal, Theme.Metrics.pt10)
        .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt40, maxHeight: Theme.Metrics.pt40, alignment: .leading)
        .background(hover ? Theme.Palette.secondaryHover : .clear)
        .opacity(disabled ? Theme.Opacity.disabled : 1)
        .contentShape(.rect).onHover { hover = $0 }
        .onTapGesture { if !disabled { download() } }
        .disabled(disabled).help("\(file.filename) sichern und im Finder anzeigen")
    }
}

private struct OrbiLibraryDownload: Decodable { let file: OrbiLibraryFile }

private struct OrbiLibraryView: View {
    let model: AppModel
    let bot: Bot
    @State private var response: OrbiLibraryResponse?
    @State private var error: String?
    @State private var loading = false
    @State private var loadGeneration = 0
    @State private var downloading: String?
    @State private var query = ""
    @State private var filter = "Alle"
    @Environment(\.staticRendering) private var staticRendering

    private var visibleFiles: [OrbiLibraryFile] {
        (response?.files ?? []).filter { LibraryFileFilter.matches(filter, filename: $0.filename, mediaType: $0.mediaType, query: query) }
    }

    var body: some View {
        // Figma Bibliothek (50:15133): Abstand 12 zwischen Suchfeld, Chips und Liste.
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            TextField("Dateien suchen", text: $query, prompt: Text("Dateien suchen").foregroundStyle(Theme.Palette.mutedForeground)).webInput().accessibilityLabel("Dateien suchen")
            ScrollView(.horizontal) {
                HStack(spacing: Theme.Metrics.pt6) {
                    ForEach(["Alle", "Bilder", "PDFs", "Dokumente"], id: \.self) { item in
                        Button(item) { filter = item }.buttonStyle(LibraryFilterStyle(selected: filter == item))
                            .accessibilityAddTraits(filter == item ? [.isButton, .isSelected] : .isButton)
                    }
                }
            }.scrollIndicators(.hidden)
            if loading { HStack(spacing: Theme.Metrics.pt8) { Spinner(size: Theme.Metrics.pt14); Text("Dateien laden …") } }
            if let error {
                InlineAlert(text: error)
                Button("Erneut versuchen") { Task { await load() } }.buttonStyle(.card(.outline))
            }
            if !visibleFiles.isEmpty {
                VStack(spacing: Theme.Metrics.pt0) {
                    ForEach(visibleFiles) { file in
                        LibraryFileRow(file: file, downloading: downloading == file.id, disabled: downloading != nil) {
                            Task { await download(file) }
                        }
                        if file.id != visibleFiles.last?.id { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
                    }
                }
                .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
                .clipShape(.rect(cornerRadius: Theme.Radius.lg))
                .overlay { RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5) }
            }
            if !loading, response != nil, visibleFiles.isEmpty {
                Text(query.isEmpty && filter == "Alle" ? "Noch keine Dateien." : "Keine passenden Dateien.")
                    .font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).padding(.vertical, Theme.Metrics.pt12)
            }
            if let response {
                if response.truncated { Text("Liste gekürzt.").font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground) }
            }
        }
        .task(id: bot.id) { if !staticRendering { await load() } }
        .onChange(of: model.events.board.chats) { old, new in
            let changed = Set(old.keys).union(new.keys).contains { key in
                let before = old[key], after = new[key]
                return (before?.botId == bot.id || after?.botId == bot.id) && before != after
            }
            if changed && !staticRendering { Task { await load() } }
        }
        .onChange(of: model.events.connected) { _, connected in
            if connected && !staticRendering { Task { await load() } }
        }
    }

    private var path: String { "/v1/bots/\(bot.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? "")/library" }

    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        loading = true
        error = nil
        do {
            let result: OrbiLibraryResponse = try await model.client.get(path)
            if generation == loadGeneration { response = result }
        } catch {
            if generation == loadGeneration { self.error = error.localizedDescription }
        }
        if generation == loadGeneration { loading = false }
    }

    private func download(_ file: OrbiLibraryFile) async {
        guard downloading == nil else { return }
        downloading = file.id
        defer { downloading = nil }
        error = nil
        do {
            guard let identifier = file.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) else { throw ServiceError.invalidResponse }
            let result: OrbiLibraryDownload = try await model.client.get("\(path)/\(identifier)")
            guard let encoded = result.file.data, let data = Data(base64Encoded: encoded), data.count == result.file.size else { throw ServiceError.invalidResponse }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (file.filename as NSString).lastPathComponent
            guard await panel.begin() == .OK, let url = panel.url else { return }
            try data.write(to: url, options: .atomic)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch { self.error = error.localizedDescription }
    }
}

// Inhalt im Gruppenchat: Reiter „Gruppe“ (Name, Orbis, Speichern, Verlauf leeren, Gruppe löschen) und „Computer“.
struct GroupSidePanel: View {
    let model: AppModel
    let group: OrbiGroup
    @State private var tab = "group"
    @State private var editor: GroupEditorModel
    @State private var shown: String?

    init(model: AppModel, group: OrbiGroup) {
        self.model = model
        self.group = group
        _editor = State(initialValue: GroupEditorModel(editing: group))
    }

    private var dirty: Bool { editor.name != group.name || Set(editor.memberIds) != Set(group.members.map(\.id)) }

    var body: some View {
        // Kopf wie im Orbi-Panel (Figma 119:24154/24155): Name 15 Medium, darunter Reiter 26; Blockabstand 16.
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            Text(group.name).font(Theme.Fonts.geist(Theme.Fonts.size15, .medium)).lineLimit(1).frame(maxWidth: .infinity)
                .padding(.horizontal, Theme.Metrics.pt24)
            PanelTabs(items: ["group", "computer"], selection: $tab) { $0 == "group" ? "Gruppe" : "Computer" }
            if tab == "group" {
                ScrollView {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
                        DialogField("Name") { TextField("", text: $editor.name).webInput() }
                        DialogField("Orbis") {
                            // Figma Mitglieder (50:15363): gemeinsame Box card, r10, Rand 0,5, Trenner 0,5.
                            VStack(spacing: Theme.Metrics.pt0) {
                                ForEach(model.botStore.orbis) { bot in
                                    let on = editor.memberIds.contains(bot.id)
                                    PanelMemberRow(bot: bot, on: on, disabled: !on && editor.limitReached, toggle: { editor.toggle(bot.id) },
                                                   openChat: { model.selection = .bot(bot.id) },
                                                   edit: { model.sheet = .editBot(id: bot.id, tab: .profile) })
                                    if bot.id != model.botStore.orbis.last?.id { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
                                }
                            }
                            .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
                            .clipShape(.rect(cornerRadius: Theme.Radius.lg))
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
                            // P31: Hinweis unter der Box, 11.
                            Text("Höchstens 6 Orbis je Gruppe – weitere sind ausgegraut.").font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground)
                        }
                        if let error = editor.error { InlineAlert(text: error) }
                        // Web: „Speichern“ über beide Spalten (col-span-2), darunter Verlauf leeren / Gruppe löschen.
                        Button("Speichern") { Task { await model.save(editor) } }.buttonStyle(.card(.primary))
                            .disabled(editor.saving || !dirty)
                            .environment(\.webButtonFill, true)
                        PanelFooter {
                            Button("Verlauf leeren") { model.botStore.requestDelete(.clear(chatId: group.id, name: group.name, group: true)) }
                                .buttonStyle(.card(.outline)).disabled(editor.saving)
                            Button("Gruppe löschen") { model.botStore.requestDelete(.group(group)) }.buttonStyle(.card(.destructive)).disabled(editor.saving)
                        }
                    }
                    .padding(.top, Theme.Metrics.pt4).padding(.bottom, Theme.Metrics.pt16)
                }
                .scrollIndicators(.never)
            } else {
                // Ein Orbi gleichzeitig: Chips wie im Web (36 hoch, Figur 28, Glas), gewählter foreground 15 %.
                ScrollView(.horizontal) {
                    HStack(spacing: Theme.Metrics.pt6) {
                        ForEach(model.botStore.orbis.filter { bot in group.members.contains { $0.id == bot.id } }) { bot in
                            ComputerChip(bot: bot, active: (shown ?? group.members.first?.id) == bot.id) { shown = bot.id }
                        }
                    }
                    .padding(.bottom, Theme.Metrics.pt4)
                }
                .scrollIndicators(.never)
                if let bot = model.botStore.bot(id: shown ?? group.members.first?.id) { ComputerView(model: model, session: model.desktops.session(for: bot)).id(bot.id).frame(maxHeight: .infinity, alignment: .top) }
            }
        }
        .padding(.horizontal, Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt24).padding(.bottom, Theme.Metrics.pt16)
        .overlay(alignment: .topTrailing) { PanelCloseButton(model: model).padding(Theme.Metrics.pt8) }
    }
}

// Fuß in zwei Spalten (Web: grid grid-cols-2 gap-2): keine Schaltfläche bricht einzeln um.
private struct PanelFooter<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: Theme.Metrics.pt8), GridItem(.flexible())], spacing: Theme.Metrics.pt8) { content }
            .environment(\.webButtonFill, true)
    }
}

// Zeile der Mitgliederliste: Kästchen, Figur 28, Name; beim Überfahren muted und Knöpfe Chat/Bearbeiten (Ghost 28, 150 ms).
private struct PanelMemberRow: View {
    let bot: Bot
    let on: Bool
    let disabled: Bool
    let toggle: () -> Void
    let openChat: () -> Void
    let edit: () -> Void
    @State private var hover = false

    var body: some View {
        // Figma Mitglied (50:18609): 36 hoch, innen 0/10, Abstand 10, Figur 20, Name 12, Hover secondaryHover, deaktiviert 40 % (ganze Zeile).
        HStack(spacing: Theme.Metrics.pt4) {
            Button(action: toggle) {
                HStack(spacing: Theme.Metrics.pt10) {
                    WebCheckbox(on: on)
                    OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt20, live: false, botId: bot.id)
                    Text(bot.name).font(Theme.Fonts.small).lineLimit(1)
                    Spacer(minLength: Theme.Metrics.pt0)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
            Group {
                Button(action: openChat) { Image(systemName: "message").font(.system(size: Theme.Metrics.pt14)) }
                    .buttonStyle(.web(.ghost, .iconXS)).accessibilityLabel("Chat mit \(bot.name)")
                Button(action: edit) { Image(systemName: "pencil").font(.system(size: Theme.Metrics.pt14)) }
                    .buttonStyle(.web(.ghost, .iconXS)).accessibilityLabel("\(bot.name) bearbeiten")
            }
            .opacity(hover ? 1 : 0)
            .animation(Theme.Motion.hover.animation, value: hover)
        }
        .padding(.horizontal, Theme.Metrics.pt10).frame(height: Theme.Metrics.pt36)
        .background(hover ? Theme.Palette.secondaryHover : .clear)
        .opacity(disabled ? Theme.Opacity.disabled : 1)
        .onHover { hover = $0 }
    }
}

private struct ComputerChip: View {
    let bot: Bot
    let active: Bool
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Metrics.pt8) {
                OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt28, live: false, botId: bot.id)
                Text(bot.name).font(Theme.Fonts.bodyMedium).lineLimit(1).frame(maxWidth: Theme.Metrics.pt128, alignment: .leading)
            }
            .padding(.leading, Theme.Metrics.pt4).padding(.trailing, Theme.Metrics.pt16)
            .frame(height: Theme.Metrics.pt36)
            .background(active ? Theme.Palette.glassActive : hover ? Theme.Palette.glassHover : Theme.Palette.glass, in: .capsule)
            .overlay(Capsule().strokeBorder(Theme.Palette.glassRing, lineWidth: Theme.Metrics.pt0_5))   // Figma Computer-Chips 140:42164: Rand 0,5
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(Theme.Motion.hover.animation, value: hover)
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}

// Lade-Fläche des Computers (Web: Skeleton aspect-video r 10, bg-muted, animate-pulse 2 s).
struct ComputerPlaceholder: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.ambient(paused: reduceMotion)) { context in
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .fill(Theme.Palette.muted)
                .opacity(reduceMotion ? 1 : Self.pulse(at: context.date.timeIntervalSinceReferenceDate))
                .aspectRatio(16 / 9, contentMode: .fit)
        }
        .accessibilityLabel("Computer lädt")
    }

    // Tailwind animate-pulse: 2 s, cubic-bezier(.4,0,.6,1), Deckkraft 1 → 0,5 (bei 50 %) → 1.
    static func pulse(at t: Double) -> Double {
        let phase = t.truncatingRemainder(dividingBy: Theme.Metrics.pt2) / 2
        let half = phase < 0.5 ? phase * 2 : (1 - phase) * 2
        return 1 - 0.5 * Theme.Motion.pulse.value(at: half)
    }
}
