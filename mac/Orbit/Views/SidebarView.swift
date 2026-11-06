import AppKit
import SwiftUI

struct SidebarView: View {
    @Bindable var model: AppModel
    @State private var mainHover = false
    @State private var iconHover = false
    @State private var brandShown = false
    @State private var settingsHover = false
    @State private var renamingId: String?   // S25/S32: Umbenennen aus dem Kontextmenü startet das Feld in der Zeile

    @Environment(\.openSettings) private var openSettings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let error = model.startupError {
                shell { SidebarHint(title: "Dienst nicht erreichbar", detail: error, retry: { Task { await model.start() } }) }
            } else {
                switch model.botStore.state {
                case .idle, .loading:
                    shell { SidebarHint(title: "Lädt …", detail: nil, retry: nil, loading: true) }
                case .failed(let message):
                    shell { SidebarHint(title: "Orbis konnten nicht geladen werden", detail: message, retry: { Task { await model.start() } }) }
                case .loaded:
                    list
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.Palette.sidebar)
    }

    // S38 (50:18096–98): Laden und Fehler stehen als Hinweis in der Liste, Kopf und Fuß bleiben.
    private func shell<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: Theme.Metrics.pt0) {
            brand
            content()
            settingsButton
        }
    }

    // Aufbau wie components/sidebar-nav.tsx: Kopf mit Suche, „Geplant“, Hauptorbi als Karte, „Chats“, „Gruppen“, Einstellungen.
    @ViewBuilder private var list: some View {
        let orbis = model.botStore.orbis
        if orbis.isEmpty && model.botStore.groups.isEmpty {
            // Leerer Zustand: noch kein Orbi. Der erste Orbi wird in der Mitte des Fensters angelegt, nicht hier.
            Spacer(minLength: Theme.Metrics.pt0)
        } else {
            let main = orbis.first(where: \.isMain)
            VStack(spacing: Theme.Metrics.pt0) {
                brand
                ScrollView {
                    // S31: Suche → Hauptorbi 12 (im Kopf), Hauptorbi → Zeilen 12 (Schiene: 8, ohne Trennlinie, S29).
                    VStack(spacing: collapsed ? Theme.Metrics.pt8 : Theme.Metrics.pt12) {
                        if let main { if collapsed { mainIcon(main) } else { mainCard(main) } }
                        if collapsed {
                            Rectangle().fill(Theme.Palette.sidebarBorder).frame(height: Theme.Metrics.pt0_5)
                                .padding(.horizontal, Theme.Metrics.pt16)
                        }
                        group() {
                            ForEach(chatRows(excluding: main?.id)) { item in
                                switch item {
                                case .bot(let bot):
                                    let state = model.state(forBot: bot)
                                    Row(name: bot.name, tooltip: bot.name + " · " + state.caption, renaming: renaming("bot-" + bot.id), rename: { try await rename(bot, to: $0) }, subtitle: state == .limit ? (model.limitText(chatId: bot.chatId).map { "Pausiert, \($0)" } ?? "Pausiert, wartet") : bot.job, working: state == .working, limited: state == .limit, dot: model.showsStatusDot(bot: bot), selected: model.selection == .bot(bot.id), collapsed: collapsed) { hover in
                                        OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, state: state, size: Theme.Metrics.pt40, live: true, hoverArea: hover, botId: bot.id, role: .sidebar)
                                    }
                                    .probe("chat-row-\(item.id)")
                                    .onTapGesture { open(.bot(bot.id), chatId: bot.chatId) }
                                    .webContextMenu(screenName: "kontext-chat") { botMenu(bot) }
                                case .group(let group):
                                    Row(name: group.name, tooltip: group.name + " · " + model.state(forGroup: group.id).caption, renaming: renaming("group-" + group.id), rename: { try await model.botStore.updateGroup(id: group.id, name: $0, botIds: group.members.map(\.id)) }, subtitle: group.members.count == 1 ? "1 Orbi" : "\(group.members.count) Orbis", dot: model.events.sidebar.dot(chatIds: [group.id], state: model.state(forGroup: group.id), openChatId: model.openChatId), selected: model.selection == .group(group.id), collapsed: collapsed) { hover in
                                        AvatarStack(members: group.members, size: Theme.Metrics.pt40, live: true, role: .sidebar, hoverArea: hover)
                                    }
                                    .onTapGesture { open(.group(group.id), chatId: group.id) }
                                    .webContextMenu { groupMenu(group) }
                                }
                            }
                            .animation(reduceMotion ? nil : Theme.Motion.sidebar.animation, value: chatRows(excluding: main?.id).map(\.id))
                        }
                    }
                }
                .scrollIndicators(.never)
                settingsButton
            }
        }
    }

    private func renaming(_ id: String) -> Binding<Bool> {
        Binding(get: { renamingId == id }, set: { renamingId = $0 ? id : nil })
    }

    private enum ChatRow: Identifiable {
        case bot(Bot), group(OrbiGroup)
        var id: String { switch self { case .bot(let bot): "bot-" + bot.id; case .group(let group): "group-" + group.id } }
        var chatId: String { switch self { case .bot(let bot): bot.chatId; case .group(let group): group.id } }
        var date: Date { switch self { case .bot(let bot): bot.lastMessageAt; case .group: .distantPast } }
    }

    private func chatRows(excluding mainId: String?) -> [ChatRow] {
        let rows = model.botStore.orbis.filter { $0.id != mainId }.map(ChatRow.bot) + model.botStore.groups.map(ChatRow.group)
        let dates = Dictionary(model.chatStore.chats.map { ($0.id, $0.lastMessageAt) }, uniquingKeysWith: max)
        func activity(_ item: ChatRow) -> Date { max(item.date, dates[item.chatId] ?? .distantPast, model.activity[item.chatId] ?? .distantPast) }
        return rows.enumerated().sorted {
            let left = activity($0.element), right = activity($1.element)
            return left == right ? $0.offset < $1.offset : left > right
        }.map(\.element)
    }

    // Fuß: nur Profilbild und Benutzername; Klick öffnet Optionen. Eingeklappt nur das Bild.
    private var settingsButton: some View {
        let name = currentUserName
        return WebMenuButton(alignment: .leading, screenName: "menu-account", items: {
            [WebMenuItem(title: "Einstellungen", icon: "gearshape") { openSettingsSection(.setup) },
             WebMenuItem(title: "Nutzung", icon: "gauge.with.needle") { openSettingsSection(.usage) },
             WebMenuItem(title: "Marktplatz", icon: "storefront") { openSettingsSection(.marketplace) },
             WebMenuItem(title: "Darstellung", icon: "paintpalette") { openSettingsSection(.appearance) }]
        }) { open in
            Group {
                if collapsed {
                    UserProfileImage(name: name, size: Theme.Metrics.pt32)
                        .frame(width: Theme.Layout.railItemWidth, height: Theme.Metrics.pt32)
                        .background(model.settingsOpen || open ? Theme.Palette.glassActive : (settingsHover ? Theme.Palette.secondaryHover : .clear), in: .rect(cornerRadius: Theme.Radius.md))
                        .contentShape(.rect(cornerRadius: Theme.Radius.md))
                        .frame(maxWidth: .infinity)
                } else {
                    HStack(spacing: Theme.Metrics.pt8) {
                        UserProfileImage(name: name, size: Theme.Metrics.pt24)
                        Text(name).font(Theme.Fonts.small).lineLimit(1)
                        Spacer(minLength: Theme.Metrics.pt0)
                    }
                    .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt32)
                    .foregroundStyle(Theme.Palette.foreground)
                    .background(model.settingsOpen || open ? Theme.Palette.glassActive : (settingsHover ? Theme.Palette.secondaryHover : .clear), in: .rect(cornerRadius: Theme.Radius.md))
                    .contentShape(.rect(cornerRadius: Theme.Radius.md))
                }
            }
        }
        .foregroundStyle(Theme.Palette.foreground)
        .onHover { settingsHover = $0 }
        .animation(Theme.Motion.hover.animation, value: settingsHover || model.settingsOpen)
        .padding(.horizontal, collapsed ? Theme.Metrics.pt12 : Theme.Metrics.pt10).padding(.bottom, collapsed ? Theme.Metrics.pt12 : Theme.Metrics.pt10)
        .webTooltip(name, edge: .trailing, enabled: collapsed)
        .accessibilityLabel(name)
        .probe("sidebar-settings")
    }

    private var currentUserName: String {
        let full = NSFullUserName().trimmingCharacters(in: .whitespacesAndNewlines)
        return full.isEmpty ? NSUserName() : full
    }

    private func openSettingsSection(_ section: SettingsSection) {
        model.settings.section = section
        openSettings()
    }

    private var collapsed: Bool { model.sidebarCollapsed }

    // Kopf: Die Seitenleiste reicht bis zur Fensterkante. Oben sitzen die Ampelknöpfe (setzt WindowChrome), rechts daneben Seitenleiste ein/aus
    // und „Neu“; darunter Marke und Suche. Eingeklappt (schmale Schiene): unter den Ampelknöpfen untereinander Umschalter, „Neu“ und Suche.
    @ViewBuilder private var brand: some View {
        if collapsed {
            VStack(spacing: Theme.Metrics.pt8) {   // Abstand 8 (S29)
                Color.clear.frame(height: TopBarMetrics.height - Theme.Metrics.pt8)
                toggleButton
                plusMenu
                SearchIconButton(model: model)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, Theme.Metrics.pt10)
        } else {
            VStack(spacing: Theme.Metrics.pt8) {   // Kopf → Suche 8 (S31)
                // Figma: Knopfzeile 32 hoch, waagerecht, Abstand 8, innen 4 links/rechts, 10 vom Rand der Seitenleiste (bei 240: 220 × 32).
                // Feste Höhe und feste Knopfgrößen: nichts springt beim Scrollen im Chat oder beim Ändern der Fenstergröße.
                HStack(spacing: Theme.Metrics.pt8) {
                    Text("Orbit").font(Theme.Fonts.geist(Theme.Fonts.size13, .semibold)).foregroundStyle(Theme.Palette.foreground)   // Figma 50:15485
                        .probe("sidebar-brand")
                    Spacer(minLength: Theme.Metrics.pt0)
                    toggleButton
                    plusMenu
                }
                .padding(.leading, TopBarMetrics.controlsInset - Theme.Metrics.pt10)
                .padding(.trailing, Theme.Metrics.pt4)
                .frame(height: Theme.Layout.sidebarControls)
                .probe("sidebar-controls")
                .padding([.top, .horizontal], Theme.Metrics.pt10)
                SidebarSearchField(model: model)
                .padding(.horizontal, Theme.Metrics.pt10)
            }
            .padding(.bottom, Theme.Metrics.pt12)
        }
    }

    // Web: DropdownMenu align end, Auslöser Ghost-Knopf rund mit Hover sidebar-accent (28, eingeklappt 40).
    private var plusMenu: some View {
        WebMenuButton(alignment: .leading, screenName: "menu-plus", items: {   // Breite: Theme.Menu.minWidth (Grok-Menü statt Figma 180)
            [WebMenuItem(title: "Neuer Orbi", icon: "plus") { model.sheet = .newBot },
             WebMenuItem(title: "Neue Gruppe", icon: "person.2") { model.sheet = .newGroup }]
        }) { open in SidebarIconLabel(systemName: "plus", lit: open, size: Theme.Metrics.pt24, rail: collapsed) }
        .accessibilityLabel("Neu erstellen")
    }

    // Web: SidebarTrigger (PanelLeft, ⌘B).
    private var toggleButton: some View {
        Button { model.toggleSidebar() } label: { SidebarIconLabel(systemName: "sidebar.left", size: Theme.Metrics.pt24, rail: collapsed) }
            .buttonStyle(.plain)
            .keyboardShortcut("b", modifiers: .command)
            .accessibilityLabel("Seitenleiste umschalten")
    }

    // Hauptorbi eingeklappt (S29): Figur 40 ohne Stern, Fläche 52 r14 nur bei Hover und geöffnet, Tooltip „Name · Zustand“.
    private func mainIcon(_ bot: Bot) -> some View {
        let selected = model.selection == .bot(bot.id)
        let state = model.state(forBot: bot)
        return ZStack(alignment: .topTrailing) {
            OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, state: state, size: Theme.Metrics.pt40, live: true, hoverArea: iconHover, botId: bot.id, role: .sidebar)
                .modifier(OnboardingFigure())
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            MainOrbiBadge(size: Theme.Metrics.pt14, tint: selected ? Theme.Palette.glassActive : (iconHover ? Theme.Palette.secondaryHover : .clear)).offset(x: -Theme.Metrics.pt1, y: Theme.Metrics.pt26)
            SidebarDot(dot: model.showsStatusDot(bot: bot), rail: true).offset(x: -Theme.Metrics.pt1, y: Theme.Metrics.pt1)
        }
        .onHover { iconHover = $0 }
        // Figma „Schienen-Eintrag“ (50:17842): Figur 40, Fläche 52 r14 nur bei Hover (secondaryHover) und geöffnet (glassActive).
        .frame(width: Theme.Metrics.pt52, height: Theme.Metrics.pt52)
        .background(selected ? Theme.Palette.glassActive : (iconHover ? Theme.Palette.secondaryHover : .clear), in: .rect(cornerRadius: Theme.Radius.xl))
        .contentShape(.rect(cornerRadius: Theme.Radius.xl))
        .webTooltip(bot.name + " · " + state.caption, edge: .trailing)
        .frame(maxWidth: .infinity)
        .onTapGesture { open(.bot(bot.id), chatId: bot.chatId) }
        .webContextMenu { botMenu(bot) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    // Hauptorbi geöffnet (S11, 49:16209): kleiner Kasten r14 glass (Figma 96 × 91, mittig) um Figur und Name, die Karte selbst ohne Fläche.
    private func mainCard(_ bot: Bot) -> some View {
        let selected = model.selection == .bot(bot.id)
        let state = model.state(forBot: bot)
        let box = VStack(spacing: Theme.Metrics.pt0) {
            ZStack(alignment: .bottomTrailing) {
                OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, state: state, size: Theme.Metrics.pt56, live: true, hoverArea: mainHover, botId: bot.id, role: .sidebar)
                    .modifier(OnboardingFigure())
                MainOrbiBadge(size: Theme.Metrics.pt18, tint: selected ? Theme.Palette.glass : (mainHover ? Theme.Palette.glassHover : .clear)).offset(x: -Theme.Metrics.pt1, y: -Theme.Metrics.pt2)
            }
            // Figma „Liste Hauptorbi“ (49:16212): darunter nur der Name, 12 Medium foreground, Abstand 6.
            SidebarName(name: bot.name, font: Theme.Fonts.smallMedium, editing: renaming("bot-" + bot.id)) { try await rename(bot, to: $0) }
                .foregroundStyle(Theme.Palette.foreground).padding(.top, Theme.Metrics.pt6)
        }
        .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt7)
        .frame(minWidth: Theme.Layout.mainBoxWidth)
        .overlay(alignment: .topTrailing) { SidebarDot(dot: model.showsStatusDot(bot: bot)).padding(Theme.Metrics.pt6) }
        .background(selected ? Theme.Palette.glass : (mainHover ? Theme.Palette.glassHover : .clear), in: .rect(cornerRadius: Theme.Radius.xl))
        return box
            .frame(maxWidth: .infinity)
            .onHover { mainHover = $0 }
            .animation(Theme.Motion.sidebar.animation, value: mainHover)
            .probe("main-card")
            .padding(.horizontal, Theme.Metrics.pt10)
            .contentShape(.rect)
            .onTapGesture { open(.bot(bot.id), chatId: bot.chatId) }
            .webContextMenu { botMenu(bot) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    // Chat öffnen; auch ein Klick auf den schon offenen Chat zählt als Hinsehen („fertig“ geht weg).
    private func open(_ target: AppModel.Selection, chatId: String) {
        model.selection = target
        model.events.acknowledge(chatId: chatId)
        model.search.resignField()
    }

    private func rename(_ bot: Bot, to name: String) async throws {
        let editor = BotEditorModel(editing: bot, others: model.botStore.orbis)
        editor.name = name
        if let message = editor.validationMessage { throw SidebarRenameError(message: message) }
        try await model.botStore.update(id: bot.id, editor.form)
    }

    // Rechtsklick (S25): Orbi „Bearbeiten, Aussehen anpassen, Umbenennen, Verlauf leeren, Trenner, Löschen“; in der Schiene ohne „Umbenennen“ (kein Feld).
    private func botMenu(_ bot: Bot) -> [WebMenuItem] {
        var items = [WebMenuItem(title: "Bearbeiten", icon: "gearshape") { model.edit(.bot(bot.id)) },
                     WebMenuItem(title: "Aussehen anpassen", icon: "paintpalette") { model.sheet = .editBot(id: bot.id, tab: .look) }]
        if !collapsed { items.append(WebMenuItem(title: "Umbenennen", icon: "pencil") { renamingId = "bot-" + bot.id }) }
        items += [WebMenuItem(title: "Verlauf leeren", icon: "eraser") { model.botStore.requestDelete(.clear(chatId: bot.chatId, name: bot.name, group: false)) },
                  WebMenuItem(title: "Löschen", icon: "trash", destructive: true, separatorBefore: true) { model.botStore.requestDelete(.bot(bot)) }]
        return items
    }

    // Gruppe: „Gruppe bearbeiten, Mitglieder (öffnet denselben Editor), Umbenennen, Verlauf leeren, Trenner, Gruppe löschen“.
    private func groupMenu(_ group: OrbiGroup) -> [WebMenuItem] {
        var items = [WebMenuItem(title: "Gruppe bearbeiten", icon: "gearshape") { model.edit(.group(group.id)) },
                     WebMenuItem(title: "Mitglieder", icon: "person.2") { model.edit(.group(group.id)) }]
        if !collapsed { items.append(WebMenuItem(title: "Umbenennen", icon: "pencil") { renamingId = "group-" + group.id }) }
        items += [WebMenuItem(title: "Verlauf leeren", icon: "eraser") { model.botStore.requestDelete(.clear(chatId: group.id, name: group.name, group: true)) },
                  WebMenuItem(title: "Gruppe löschen", icon: "trash", destructive: true, separatorBefore: true) { model.botStore.requestDelete(.group(group)) }]
        return items
    }

    private func group<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: collapsed ? Theme.Metrics.pt4 : Theme.Metrics.pt2, content: content)   // Zeilen untereinander 2 (S31)
            .padding(.horizontal, Theme.Metrics.pt10)
    }

    // Zeile 56 hoch, Radius 14, Figur 28, Abstand 12 (Web: h-14 gap-3 rounded-xl, Hover sidebar-accent/60, aktiv sidebar-accent).
    private struct Row<Leading: View>: View {
        let name: String
        var tooltip: String? = nil
        var renaming: Binding<Bool> = .constant(false)
        let rename: (String) async throws -> Void
        let subtitle: String
        var working = false
        var limited = false
        var dot: SidebarStatus.Dot? = nil
        let selected: Bool
        var collapsed = false
        @ViewBuilder let leading: (Bool) -> Leading
        @State private var hover = false

        var body: some View {
            if collapsed {
                // Eingeklappt: 40 rund, Figur 28 mittig, Tooltip mit dem Namen rechts.
                // Figma „Schienen-Eintrag“ (50:17842): Figur 40, Fläche 52 r14.
                leading(hover).frame(width: Theme.Metrics.pt40, height: Theme.Metrics.pt40)
                    .frame(width: Theme.Metrics.pt52, height: Theme.Metrics.pt52)
                    .overlay(alignment: .topTrailing) { SidebarDot(dot: dot, rail: true).offset(x: -Theme.Metrics.pt1, y: Theme.Metrics.pt1) }   // 11 mit Rand 2 (S8)
                    .background(fill, in: .rect(cornerRadius: Theme.Radius.xl))
                    .contentShape(.rect(cornerRadius: Theme.Radius.xl))
                    .onHover { hover = $0 }
                    .animation(Theme.Motion.hover.animation, value: hover)
                    .webTooltip(tooltip ?? name, edge: .trailing)
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(name)
                    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            } else {
                expanded
            }
        }

        private var expanded: some View {
            // Figma „Seitenleiste-Orbi“ (26:10956): 220 × 60, innen 0/10, Abstand 10, r12, Textspalte Abstand 2, Name 13 Medium, Vorschau 12 muted.
            HStack(alignment: .center, spacing: Theme.Metrics.pt6) {
                leading(hover).frame(width: Theme.Metrics.pt40, height: Theme.Metrics.pt40)
                HStack(alignment: .center, spacing: Theme.Metrics.pt8) {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                        SidebarName(name: name, editing: renaming, save: rename)
                        // Web: Aufgabe, während der Arbeit „arbeitet…“. Beim Umbenennen ausgeblendet (S32).
                        if !renaming.wrappedValue {
                            Group { if working { WorkingLabel() } else { Text(subtitle) } }
                                .font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                        }
                    }
                    Spacer(minLength: Theme.Metrics.pt0)
                    SidebarDot(dot: dot)   // 8 ohne Ring, mittig rechts (S8)
                }
            }
            .foregroundStyle(Theme.Palette.foreground)
            .padding(.horizontal, Theme.Metrics.pt10)
            .frame(maxWidth: .infinity, minHeight: Theme.Metrics.pt60, maxHeight: Theme.Metrics.pt60, alignment: .leading)
            .background(fill, in: .rect(cornerRadius: Theme.Radius.row))
            .contentShape(.rect(cornerRadius: Theme.Radius.row))
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        }

        // Figma: Hover secondaryHover, geöffnet glassActive (Endfassung 124:29418).
        private var fill: Color {
            selected ? Theme.Palette.glassActive : (hover ? Theme.Palette.secondaryHover : .clear)
        }
    }
}

private struct SidebarRenameError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct SidebarName: View {
    let name: String
    var font: Font = Theme.Fonts.geist(Theme.Fonts.size13, .medium)
    @Binding var editing: Bool
    let save: (String) async throws -> Void
    @State private var draft = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            if editing {
                // Figma 49:17059: Feld 150 × 22, innen 6, r6, field, Rand mutedForeground 50 % 0,5, Text 12.
                TextField("Name", text: $draft, prompt: Text("Name").foregroundStyle(Theme.Palette.mutedForeground)).textFieldStyle(.plain).font(Theme.Fonts.small).focused($focused)
                    .disabled(busy).onSubmit(commit)
                    .onKeyPress(.escape) { editing = false; error = nil; return .handled }
                    .padding(.horizontal, Theme.Metrics.pt6)
                    .frame(width: Theme.Layout.renameFieldWidth, height: Theme.Layout.renameFieldHeight)
                    .background(Theme.Palette.field, in: .rect(cornerRadius: Theme.Radius.sm))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).strokeBorder(Theme.Palette.mutedForeground.opacity(0.5), lineWidth: Theme.Metrics.pt0_5))
                    .accessibilityLabel("Name ändern")
            } else {
                Text(name).lineLimit(1)
                    .onTapGesture(count: 2, perform: begin)
                    .accessibilityAction(named: Text("Umbenennen"), begin)
            }
            if let error { Text(error).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.destructive) }
        }
        .font(font)
        .onChange(of: editing, initial: true) { _, now in if now { draft = name; error = nil; focused = true } }
    }

    private func begin() { editing = true }
    private func commit() {
        let value = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy else { return }
        guard !value.isEmpty else { error = "Bitte gib einen Namen ein."; return }
        busy = true
        Task {
            defer { busy = false }
            do { try await save(value); editing = false; error = nil }
            catch { self.error = error.localizedDescription }
        }
    }
}

// Figma S8: Punkt 8 ohne Ring (Zeile); an der Schiene 11 mit Rand 2 in Seitenleistenfarbe. Fertig = blau, braucht dich = orange.
struct StatusDot: View {
    var dot: SidebarStatus.Dot
    var ring = false
    var body: some View {
        let size = ring ? Theme.Status.dotSizeRail : Theme.Status.dotSizeRow
        Circle().fill(dot == .needsYou ? Theme.Status.caution : Theme.Status.info)
            .frame(width: size, height: size)
            .overlay { if ring { Circle().strokeBorder(Theme.Palette.sidebar, lineWidth: Theme.Status.dotRing) } }
            .accessibilityLabel(dot == .needsYou ? "Braucht dich" : "Fertig")
            .probe("status-dot")
    }
}

// A6 (148:70178): „fertig“ erscheint erst 2,3 s nach dem Zustandswechsel und springt kurz auf (Feder); bei „Bewegung reduzieren“ sofort.
struct SidebarDot: View {
    let dot: SidebarStatus.Dot?
    var rail = false
    @State private var shown: SidebarStatus.Dot?
    @State private var primed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if let shown { StatusDot(dot: shown, ring: rail).transition(reduceMotion ? .identity : .scale(scale: 0.2).combined(with: .opacity)) }
        }
        .animation(reduceMotion ? nil : Theme.Status.popAnimation, value: shown)
        .task(id: dot) {
            // Erster Aufbau der Zeile ist kein Zustandswechsel: Punkt steht sofort da.
            guard primed else { primed = true; shown = dot; return }
            if dot == .done, !reduceMotion {
                shown = nil
                try? await Task.sleep(for: .seconds(Theme.Status.doneDelay))
                guard !Task.isCancelled else { return }
            }
            shown = dot
        }
    }
}

// Runder Symbolknopf der Seitenleiste (Web: Button ghost icon-sm rounded-full, Hover sidebar-accent, 150 ms).
struct SidebarIconLabel: View {
    let systemName: String
    var lit = false
    var size: CGFloat = Theme.Metrics.pt28
    var filled = false     // Zweite Variante des Symbols (Seitenleiste offen)
    var rail = false       // Schiene (S29): Icon-Eintrag 48 × 32, Symbol 16, Hover r8 secondaryHover
    @State private var hover = false

    // Ausgeklappt (24): Figma Icon-Knopf (50:15490) 24 × 24 r6, Symbol 14 muted, Fläche secondaryHover bei Hover/offenem Menü.
    private var figma: Bool { size == Theme.Metrics.pt24 }

    var body: some View {
        let width = rail ? Theme.Layout.railItemWidth : size
        let height = rail ? Theme.Metrics.pt32 : size
        let radius = rail ? Theme.Radius.md : (figma ? Theme.Radius.sm : size / 2)
        Image(systemName: systemName).symbolVariant(filled ? .fill : .none).font(.system(size: rail ? Theme.Metrics.pt16 : Theme.Metrics.pt14, weight: .regular))
            .foregroundStyle(figma || rail ? Theme.Palette.mutedForeground : Theme.Palette.sidebarForeground)
            .frame(width: width, height: height)
            .background(hover || lit ? (figma || rail ? Theme.Palette.secondaryHover : Theme.Palette.sidebarAccent) : .clear, in: .rect(cornerRadius: radius))
            .contentShape(.rect(cornerRadius: radius))
            .onHover { hover = $0 }
            .animation(Theme.Motion.hover.animation, value: hover || lit)
    }
}

// Hauptorbi-Zeichen am Avatar (Web: components/chat/main-orbi-badge.tsx): schwarzer Kreis mit Stern.
// Figma 49:16142: Kreis 16 in orbi/gelborange, Rand 2 in Seitenleistenfarbe, weißer Stern 8.
private struct UserProfileImage: View {
    let name: String
    var size: CGFloat = Theme.Metrics.pt24

    var body: some View {
        ZStack {
            Circle().fill(Theme.Palette.secondary)
            Text(initials).font(Theme.Fonts.geist(size * 0.42, .medium)).foregroundStyle(Theme.Palette.foreground)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initials: String {
        let parts = name.split(whereSeparator: \.isWhitespace).prefix(2)
        let letters = parts.compactMap(\.first).map { String($0).uppercased() }
        return letters.isEmpty ? "?" : letters.joined()
    }
}

struct MainOrbiBadge: View {
    var size: CGFloat = Theme.Metrics.pt18
    var tint: Color = .clear   // Fläche des Kastens dahinter (glass/glassHover), damit der Rand wie ausgestanzt wirkt
    // Consti 05.11. (Referenz Hauptorbi): flacher orbi/gelborange-Kreis, weißer Stern ≈ halbe Kreisbreite, dunkler Rand in Hintergrundfarbe.
    var body: some View {
        Circle().fill(Theme.Palette.sidebar)
            .overlay { Circle().fill(tint) }
            .overlay { Circle().fill(Color("orbi-gelborange")).padding(size * 0.11) }
            .overlay { Image(systemName: "star.fill").font(.system(size: size * 0.36, weight: .bold)).foregroundStyle(Color.white) }
            .frame(width: size, height: size)
            .accessibilityLabel("Hauptorbi")
    }
}

// „gerade eben“ unter einer Minute, sonst gerundet wie date-fns formatDistanceToNowStrict (de); tickt alle 15 s.
struct AgoText: View {
    let date: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: Theme.Metrics.pt15)) { context in
            Text(Self.text(from: date, now: context.date))
        }
    }

    static func text(from date: Date, now: Date) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "gerade eben" }
        func unit(_ value: Int, _ one: String, _ many: String) -> String { "\(value) \(value == 1 ? one : many)" }
        let minutes = Int((seconds / 60).rounded())
        if minutes < 60 { return unit(minutes, "Minute", "Minuten") }
        let hours = Int((seconds / 3600).rounded())
        if hours < 24 { return unit(hours, "Stunde", "Stunden") }
        let days = Int((seconds / 86400).rounded())
        if days < 30 { return unit(days, "Tag", "Tage") }
        let months = Int((Double(days) / 30.4375).rounded())
        if months < 12 { return unit(months, "Monat", "Monate") }
        return unit(Int((Double(days) / 365.25).rounded()), "Jahr", "Jahre")
    }
}

struct StatusMessage: View {
    let title: String
    let detail: String?
    let retry: (() -> Void)?

    var body: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Text(title).font(Theme.Fonts.bodyMedium).foregroundStyle(Theme.Palette.foreground).multilineTextAlignment(.center)
            if let detail {
                Text(detail).font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Fonts.smallLine)).foregroundStyle(Theme.Palette.mutedForeground)
                    .multilineTextAlignment(.center)
            }
            if let retry {
                Button("Erneut versuchen", action: retry).buttonStyle(.card(.outline)).padding(.top, Theme.Metrics.pt4)
            }
        }
        .padding(Theme.Spacing.lg)
    }
}

// S38 (50:18096–98): Hinweis in der Liste, Kopf und Fuß der Seitenleiste bleiben. Laden = Spinner 14 + „Lädt …“ 11 muted;
// Fehler = circle-alert 14 + Text 11 muted + Zweit-Pille „Erneut versuchen“.
struct SidebarHint: View {
    let title: String
    let detail: String?
    let retry: (() -> Void)?
    var loading = false

    var body: some View {
        VStack(spacing: Theme.Metrics.pt8) {
            if loading {
                ProgressView().controlSize(.small).frame(width: Theme.Metrics.pt14, height: Theme.Metrics.pt14)
            } else {
                Image(systemName: "exclamationmark.circle").font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.mutedForeground)
            }
            Text(title).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).multilineTextAlignment(.center)
            if let detail {
                Text(detail).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).multilineTextAlignment(.center).lineLimit(3)
            }
            if let retry {
                Button("Erneut versuchen", action: retry).buttonStyle(.card(.secondary)).padding(.top, Theme.Metrics.pt4)
            }
        }
        .padding(.horizontal, Theme.Metrics.pt10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
